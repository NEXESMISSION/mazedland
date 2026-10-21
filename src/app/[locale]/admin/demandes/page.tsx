/* eslint-disable react-hooks/purity -- Server Component: the clock tells an
 * expired demande from a live one, and there is no client render to replay. */
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Toolbar, type Tab } from "@/components/admin/kit/Toolbar";
import { Ltr } from "@/components/ui/Ltr";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { formatDate, formatNumber, formatTND } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Row = {
  id: string;
  deal_type: string;
  category_ids: string[] | null;
  governorates: string[] | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  surface_min: number | string | null;
  rooms_min: number | null;
  furnished: string | null;
  move_in_by: string | null;
  note: string | null;
  status: string;
  alerts: boolean;
  expires_at: string;
  created_at: string;
  user: { full_name: string | null; phone: string | null } | null;
};

/**
 * Demandes (0168) — what buyers and tenants are looking for and did not find.
 *
 * Read-only: a demande belongs to the person who left it. What this page is
 * for is the other side of the catalogue — the demand an agency, a promotion
 * or a phone call to an owner could answer — and whether the matches reach it.
 */
export default async function AdminDemandesPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("adminDemandes");
  const tc = await getTranslations("common");
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const deal = sp.deal === "sale" || sp.deal === "rent" ? sp.deal : "all";

  let q = admin
    .from("property_requests")
    .select(
      `id, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min,
       furnished, move_in_by, note, status, alerts, expires_at, created_at,
       user:profiles!property_requests_user_id_fkey (full_name, phone)`,
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (deal !== "all") q = q.eq("deal_type", deal);

  const [{ data }, { data: counts }, { data: catRows }] = await Promise.all([
    q,
    admin.from("property_requests").select("deal_type"),
    admin.from("categories").select("id, label_fr, label_ar"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const cats = new Map((catRows ?? []).map((c) => [c.id as string, c as { label_fr: string; label_ar: string | null }]));

  const tally = { all: 0, sale: 0, rent: 0 };
  for (const r of (counts ?? []) as { deal_type: string }[]) {
    tally.all += 1;
    tally[r.deal_type === "rent" ? "rent" : "sale"] += 1;
  }
  const tabs: Tab[] = (["all", "sale", "rent"] as const).map((k) => ({
    value: k,
    label: t(`tabs.${k}`),
    count: tally[k],
  }));

  const matchCount = new Map<string, number>();
  if (rows.length > 0) {
    const { data: m } = await admin.from("matches").select("request_id").in("request_id", rows.map((r) => r.id));
    for (const x of (m ?? []) as { request_id: string }[]) {
      matchCount.set(x.request_id, (matchCount.get(x.request_id) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const money = (v: number | string) => `${formatTND(Number(v), locale)} ${tc("tnd")}`;

  return (
    <div>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <div className="mt-4 flex h-11 items-center border-b border-border">
        <Toolbar tabs={tabs} tabParam="deal" defaultTab="all" search={false} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted">
          {t("empty")}
        </p>
      ) : (
        <section className="mt-4 overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t("cols.date")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("cols.person")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("cols.search")}</th>
                <th className="px-4 py-3 text-end font-semibold">{t("cols.budget")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("cols.status")}</th>
                <th className="px-4 py-3 text-end font-semibold">{t("cols.matches")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rent = r.deal_type === "rent";
                const expired = new Date(r.expires_at).getTime() <= now;
                const state = expired ? "expired" : r.status === "paused" ? "paused" : "active";
                const what = (r.category_ids ?? []).length
                  ? (r.category_ids ?? []).map((id) => (cats.get(id) ? categoryLabel(cats.get(id)!, locale) : "?")).join(", ")
                  : t("anyCategory");
                const where = (r.governorates ?? []).length
                  ? (r.governorates ?? []).map((g) => governorateLabel(g, locale)).join(", ")
                  : t("anywhere");
                const extra = [
                  r.surface_min != null ? t("surfaceAtLeast", { area: formatNumber(Number(r.surface_min), locale) }) : null,
                  r.rooms_min != null ? `S+${r.rooms_min}+` : null,
                  rent && r.furnished ? t(`furnished.${r.furnished}`) : null,
                  rent && r.move_in_by ? t("moveIn", { date: formatDate(r.move_in_by, locale, "medium") }) : null,
                ].filter(Boolean);
                return (
                  <tr key={r.id} className="border-b border-border align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(r.created_at, locale, "medium")}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{r.user?.full_name ?? t("noName")}</p>
                      {r.user?.phone && <Ltr className="text-[11.5px] text-muted">{r.user.phone}</Ltr>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">
                        <span className="text-gold">{t(rent ? "kindRent" : "kindBuy")}</span> · {what} · {where}
                      </p>
                      {extra.length > 0 && <p className="mt-0.5 text-[11.5px] text-muted">{extra.join(" · ")}</p>}
                      {r.note && <p dir="auto" className="mt-0.5 line-clamp-2 text-[11.5px] italic text-muted">« {r.note} »</p>}
                    </td>
                    <td className="mazed-tabular whitespace-nowrap px-4 py-3 text-end font-semibold text-foreground">
                      {r.budget_max != null ? money(r.budget_max) : "—"}
                      {rent && r.budget_max != null && <span className="text-muted"> {t("perMonth")}</span>}
                      {r.budget_min != null && (
                        <p className="text-[11px] font-normal text-muted">{t("from", { amount: money(r.budget_min) })}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[11px] font-bold " +
                          (state === "active" ? "mazed-tone-ok" : state === "paused" ? "mazed-tone-warn" : "bg-surface-2 text-muted")
                        }
                      >
                        {t(`status.${state}`)}
                      </span>
                      {!r.alerts && <p className="mt-1 text-[11px] text-muted">{t("alertsOff")}</p>}
                    </td>
                    <td className="mazed-tabular px-4 py-3 text-end font-bold text-foreground">
                      {formatNumber(matchCount.get(r.id) ?? 0, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <p className="mt-3 text-[11.5px] text-muted">{t("note", { max: PAGE_SIZE })}</p>
    </div>
  );
}
