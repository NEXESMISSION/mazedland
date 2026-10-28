import { requireAdmin } from "@/lib/admin/session";
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Toolbar, type Tab } from "@/components/admin/kit/Toolbar";
import { Link } from "@/i18n/navigation";
import { Ltr } from "@/components/ui/Ltr";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { formatDate, formatTND } from "@/lib/utils";
import { activePlan, SHOP_COLUMNS, type ShopRow } from "@/lib/pro/shops";
import { planUsage } from "@/lib/places/server";
import { BadgeCheck, ExternalLink, FileText, Store } from "lucide-react";
import { BoutiqueActions } from "./BoutiqueActions";

export const dynamic = "force-dynamic";

const TABS = ["pending", "approved", "suspended", "rejected", "all"] as const;
type TabKey = (typeof TABS)[number];

/**
 * Boutiques (0173) — the shops asking to open, and the ones that are. Opening
 * a shop and verifying it are two decisions: the first lets its page show,
 * the second says an admin read its papers.
 */
export default async function AdminShopsPage({ searchParams }: { searchParams: Promise<{ status?: string; id?: string }> }) {
  await requireAdmin("agences");
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("adminShops");
  const tKinds = await getTranslations("pro.kinds");
  const tStatus = await getTranslations("pro.status");
  const tDocs = await getTranslations("pro.documents");
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const tab: TabKey = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as TabKey) : "pending";
  const [{ data: counts }, listRes] = await Promise.all([
    admin.from("shops").select("status"),
    (() => {
      let q = admin.from("shops").select(SHOP_COLUMNS).order("created_at", { ascending: false }).limit(100);
      if (tab !== "all") q = q.eq("status", tab);
      return q;
    })(),
  ]);
  const tally: Record<TabKey, number> = { pending: 0, approved: 0, suspended: 0, rejected: 0, all: 0 };
  for (const r of (counts ?? []) as { status: TabKey }[]) {
    tally.all += 1;
    if (r.status in tally) tally[r.status] += 1;
  }
  const tabs: Tab[] = TABS.map((k) => ({ value: k, label: t(`tabs.${k}`), count: tally[k] }));
  const shops = (listRes.data ?? []) as unknown as ShopRow[];
  const open = sp.id ? shops.find((s) => s.id === sp.id) ?? (await loadOne(sp.id)) : null;

  async function loadOne(id: string): Promise<ShopRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data } = await admin!.from("shops").select(SHOP_COLUMNS).eq("id", id).maybeSingle();
    return (data as unknown as ShopRow | null) ?? null;
  }

  // An agence chooses and pays its plan before it is opened (2026-10-28): the
  // list marks the ones whose receipt is in — they are the ones to open first.
  const paidBy = new Map<string, "captured" | "pending_review">();
  if (shops.length) {
    const { data: paid } = await admin
      .from("payments")
      .select("shop_id:metadata->>shop_id, status")
      .eq("kind", "subscription")
      .in("status", ["pending_review", "captured"])
      .in("metadata->>shop_id", shops.map((s) => s.id));
    for (const p of (paid ?? []) as { shop_id: string; status: "captured" | "pending_review" }[]) {
      if (p.status === "captured" || !paidBy.has(p.shop_id)) paidBy.set(p.shop_id, p.status);
    }
  }

  return (
    <div>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mt-4 flex h-11 items-center border-b border-border">
        <Toolbar tabs={tabs} defaultTab="pending" search={false} resetParams={["id"]} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="space-y-2">
          {shops.length === 0 && <li className="rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted">{t("empty")}</li>}
          {shops.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/agences?status=${tab}&id=${s.id}` as never}
                className={`flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 transition ${open?.id === s.id ? "ring-[var(--gold)]" : "ring-border hover:ring-[var(--gold-soft)]"}`}
              >
                <Logo path={s.logo_path} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 truncate text-[13.5px] font-bold text-foreground" dir="auto">
                    {s.name} {s.verified_at && <BadgeCheck className="size-3.5 shrink-0 text-[var(--gold)]" />}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {tKinds(s.kind)} · {governorateLabel(s.governorate, locale)} · {formatDate(s.created_at, locale, "medium")}
                    {s.status !== "approved" && paidBy.has(s.id) && (
                      <span className={`ms-1 font-bold ${paidBy.get(s.id) === "captured" ? "text-[var(--tone-ok)]" : "text-[var(--tone-warn)]"}`}>
                        · {t(paidBy.get(s.id) === "captured" ? "paidChip" : "receiptChip")}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {open && <Detail shop={open} />}
      </div>
    </div>
  );

  async function Detail({ shop }: { shop: ShopRow }) {
    const [{ data: owner }, { data: docs }, plan, live, { count: members }, { data: payRow }] = await Promise.all([
      admin!.from("profiles").select("full_name, phone").eq("id", shop.owner_id).maybeSingle(),
      admin!.from("shop_documents").select("id, kind, storage_path, file_name, created_at").eq("shop_id", shop.id).order("created_at", { ascending: false }),
      activePlan(admin!, shop.id),
      planUsage(admin!, shop.id),
      admin!.from("shop_members").select("user_id", { count: "exact", head: true }).eq("shop_id", shop.id),
      // The plan it chose: paid, its receipt waiting, or chosen with no receipt yet.
      admin!.from("payments").select("id, status, amount, metadata").eq("kind", "subscription").in("status", ["pending", "pending_review", "captured"]).contains("metadata", { shop_id: shop.id }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const pay = payRow as { id: string; status: string; amount: number | string; metadata: { product_id?: string } | null } | null;
    const { data: payPlan } = pay?.metadata?.product_id
      ? await admin!.from("products").select("name_fr").eq("id", pay.metadata.product_id).maybeSingle()
      : { data: null };
    const payPlanName = (payPlan as { name_fr: string } | null)?.name_fr ?? "";
    // The papers are private: ten-minute links, made for this page view only.
    const links = await Promise.all(
      ((docs ?? []) as { id: string; kind: string; storage_path: string; file_name: string | null; created_at: string }[]).map(async (d) => {
        const { data } = await admin!.storage.from("shop-documents").createSignedUrl(d.storage_path, 600);
        return { ...d, url: data?.signedUrl ?? null };
      }),
    );
    const row = (label: string, value: React.ReactNode) => (
      <div className="grid grid-cols-[120px_1fr] gap-3 py-1 text-[12.5px]">
        <dt className="text-muted">{label}</dt>
        <dd className="min-w-0 break-words text-foreground">{value}</dd>
      </div>
    );
    return (
      <section className="rounded-2xl bg-surface p-4 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo path={shop.logo_path} />
            <div>
              <p className="text-[15px] font-extrabold text-foreground" dir="auto">{shop.name}</p>
              <p className="text-[12px] text-muted">{tStatus(shop.status)}{shop.verified_at ? ` · ${t("verifiedOn", { date: formatDate(shop.verified_at, locale, "medium") })}` : ""}</p>
            </div>
          </div>
          {shop.status === "approved" && (
            <Link href={`/agences/${shop.slug}` as never} target="_blank" className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--gold)] hover:underline">
              {t("publicPage")} <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
        {shop.rejection_reason && <p className="mt-3 border-s-2 border-[var(--tone-bad)] ps-3 text-[12.5px] text-[var(--tone-bad)]" dir="auto">{shop.rejection_reason}</p>}
        <dl className="mt-3">
          {row(t("owner"), <>{owner?.full_name ?? "—"} {owner?.phone && <Ltr className="text-muted">{owner.phone}</Ltr>}</>)}
          {row(t("kind"), tKinds(shop.kind))}
          {row(t("place"), `${shop.city ? `${shop.city}, ` : ""}${governorateLabel(shop.governorate, locale)}`)}
          {row(t("contacts"), [shop.phone, shop.email, shop.website].filter(Boolean).join(" · ") || "—")}
          {row(t("legal"), [shop.legal_name, shop.legal_id].filter(Boolean).join(" · ") || "—")}
          {row(t("plan"), plan ? t("planValue", { name: plan.name, used: live, quota: plan.quota, date: formatDate(plan.endsAt, locale, "medium") }) : t("noPlan"))}
          {pay && row(
            t("subscription"),
            pay.status === "captured" ? (
              <span className="font-semibold text-[var(--tone-ok)]">{t("subscriptionPaid", { plan: payPlanName, amount: formatTND(Number(pay.amount), locale) })}</span>
            ) : (
              <Link href={`/admin/paiements?status=pending&a=${pay.id}` as never} className="font-semibold text-[var(--gold)] hover:underline">
                {t(pay.status === "pending_review" ? "subscriptionReceipt" : "subscriptionChosen", { plan: payPlanName })}
              </Link>
            ),
          )}
          {row(t("members"), String(members ?? 0))}
        </dl>
        {shop.description && <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-muted" dir="auto">{shop.description}</p>}
        <div className="mt-3">
          <p className="text-[12px] font-bold text-foreground">{t("documents")}</p>
          {links.length === 0 ? (
            <p className="text-[12px] text-muted">{t("noDocuments")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {links.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-[12.5px]">
                  <FileText className="size-3.5 text-muted" />
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:text-[var(--gold)]">{tDocs(d.kind)}</a>
                  ) : (
                    <span>{tDocs(d.kind)}</span>
                  )}
                  <span className="truncate text-muted" dir="auto">{d.file_name ?? ""} · {formatDate(d.created_at, locale, "medium")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <BoutiqueActions shopId={shop.id} status={shop.status} verified={!!shop.verified_at} />
        </div>
      </section>
    );
  }
}

function Logo({ path }: { path: string | null }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small logo in the console
        <img src={propertyPhotoUrl(path, { transform: { width: 100, quality: 70 } })} alt="" className="size-full object-cover" />
      ) : (
        <Store className="size-5 text-muted" />
      )}
    </span>
  );
}
