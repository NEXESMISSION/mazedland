import { getServiceSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminPager } from "@/components/admin/AdminPager";
import {
  FullBleed, Toolbar, EmptyState, QueueKeys, StatusPill,
  paymentKindLabel, EYEBROW, type Tab,
} from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS } from "@/components/admin/kit/surface";
import { Link } from "@/i18n/navigation";
import { PaymentDetail, type PaymentDetailData } from "./PaymentDetail";
import { formatTND } from "@/lib/utils";
import { Receipt } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Paiements — the v3 money queue.
 *
 * The screen this replaces could not work. `/admin/payments` called
 * `admin_payment_boxes`, which groups receipts **by auction**; `auctions` has
 * held zero rows since the pivot, so the queue returned an empty list forever
 * while three real `listing_fee` receipts sat in `pending_review` with nowhere
 * to be seen. This one is flat — a payment is a payment, and the annonce it
 * belongs to is a column, not the grouping key.
 *
 * The auction-era kinds (`deposit_lock`, `buy_now`, `final_payment`,
 * `commission`, `inspection_fee`) are excluded outright: they belong to a
 * product that no longer exists, and listing them would put rows in the queue
 * that nothing in the console can settle.
 */

const PAGE_SIZE = 30;

/** Kinds this console can settle — the v3 product line. */
const V3_KINDS = ["listing_fee", "listing_pack", "subscription", "promo", "badge", "renewal"];

type TabKey = "pending" | "captured" | "failed" | "all";

const TAB_LABEL: Record<TabKey, string> = {
  pending: "À valider",
  captured: "Validés",
  failed: "Refusés",
  all: "Tous",
};
const TAB_ORDER: TabKey[] = ["pending", "captured", "failed", "all"];

/** "À valider" spans two DB statuses: a receipt can arrive before or after the
 *  row moves to pending_review, and both are waiting on the same human. */
const TAB_STATUSES: Record<TabKey, string[] | null> = {
  pending: ["pending", "pending_review"],
  captured: ["captured"],
  failed: ["failed"],
  all: null,
};

export default async function AdminPaiementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; a?: string }>;
}) {
  const sp = await searchParams;
  const admin = getServiceSupabase();
  if (!admin) return <p className="text-[13px] text-muted">Service non configuré.</p>;

  const tab: TabKey = TAB_ORDER.includes(sp.status as TabKey)
    ? (sp.status as TabKey)
    : "pending";
  const q = (sp.q ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const SELECT = `
    id, kind, status, amount, provider, created_at, receipt_uploaded_at,
    receipt_url, receipt_urls, admin_notes, metadata, user_id,
    payer:profiles!payments_user_id_fkey (full_name, phone)
  `;

  const listQuery = () => {
    let query = admin.from("payments").select(SELECT, { count: "exact" }).in("kind", V3_KINDS);
    const statuses = TAB_STATUSES[tab];
    if (statuses) query = query.in("status", statuses);
    if (q) query = query.or(`provider_ref.ilike.%${q}%,admin_notes.ilike.%${q}%`);
    return query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  };

  // One extra query fills every tab count and the revenue strip — the same
  // trick the annonces queue uses, for the same reason: seven head-only COUNTs
  // is seven ~75 ms round trips on every click.
  const [tallyRes, listRes] = await Promise.all([
    admin.from("payments").select("status, amount, created_at").in("kind", V3_KINDS),
    listQuery(),
  ]);

  type Tally = { status: string; amount: number | string; created_at: string };
  const tallyRows = (tallyRes.data ?? []) as Tally[];

  const counts: Record<TabKey, number> = { pending: 0, captured: 0, failed: 0, all: 0 };
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let revenueMonth = 0;
  let revenueTotal = 0;

  for (const r of tallyRows) {
    counts.all += 1;
    if (r.status === "pending" || r.status === "pending_review") counts.pending += 1;
    else if (r.status === "captured") {
      counts.captured += 1;
      const amount = Number(r.amount) || 0;
      revenueTotal += amount;
      if (new Date(r.created_at) >= monthStart) revenueMonth += amount;
    } else if (r.status === "failed") counts.failed += 1;
  }

  const tabs: Tab[] = TAB_ORDER.map((t) => ({
    value: t,
    label: TAB_LABEL[t],
    count: counts[t],
  }));

  type PayRow = {
    id: string; kind: string; status: string; amount: number | string;
    provider: string; created_at: string; receipt_uploaded_at: string | null;
    receipt_url: string | null; receipt_urls: string[] | null;
    admin_notes: string | null; metadata: Record<string, unknown> | null;
    user_id: string;
    payer: { full_name: string | null; phone: string | null } | null;
  };
  const rows = (listRes.data ?? []) as unknown as PayRow[];
  const total = listRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const base = new URLSearchParams();
  if (sp.status) base.set("status", sp.status);
  if (sp.q) base.set("q", sp.q);
  if (sp.page) base.set("page", sp.page);
  const hrefBase = `/admin/paiements?${base.toString()}${base.toString() ? "&" : ""}`;
  const listHref = `/admin/paiements${base.toString() ? `?${base.toString()}` : ""}`;

  const openId = sp.a ?? null;
  const detail = openId ? await loadDetail(admin, openId) : null;

  return (
    <FullBleed>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
          Paiements
        </h1>
        <Toolbar
          tabs={tabs}
          defaultTab="pending"
          searchPlaceholder="Référence, motif…"
          resetParams={["page", "a"]}
        />
        <div className="hidden shrink-0 items-baseline gap-4 xl:flex">
          <span className={EYEBROW}>Ce mois</span>
          <span className="batta-tabular text-[13px] font-semibold text-[var(--gold)]">
            {formatTND(revenueMonth, "fr")} TND
          </span>
          <span className={EYEBROW}>Total</span>
          <span className="batta-tabular text-[13px] font-medium text-foreground">
            {formatTND(revenueTotal, "fr")} TND
          </span>
        </div>
      </header>

      <QueueKeys />

      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 w-full flex-col border-border lg:w-[360px] lg:shrink-0 lg:border-e xl:w-[400px] ${
            detail ? "hidden lg:flex" : "flex"
          }`}
        >
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                Icon={Receipt}
                tone={q ? "filtered" : "idle"}
                title={q ? "Aucun paiement ne correspond" : `Rien dans « ${TAB_LABEL[tab]} »`}
                hint={
                  q
                    ? "Essayez un autre terme, ou changez d'onglet."
                    : "Aucun reçu n'attend une décision."
                }
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
              {rows.map((r) => {
                const selected = r.id === openId;
                const waiting = r.status === "pending" || r.status === "pending_review";
                const noReceipt = waiting && !r.receipt_url && (r.receipt_urls ?? []).length === 0;
                return (
                  <li key={r.id}>
                    <Link
                      href={`${hrefBase}a=${r.id}` as "/admin/paiements"}
                      data-row-id={r.id}
                      aria-current={selected ? "true" : undefined}
                      prefetch={false}
                      className={`${ROW_BASE} ${ROW_FOCUS} ${selected ? ROW_SELECTED : ROW_IDLE}`}
                    >
                      <span className="mt-[6px] shrink-0">
                        <StatusPill status={r.status} dotOnly />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] ${
                            selected ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                          }`}
                        >
                          {r.payer?.full_name ?? "Sans nom"}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                          {paymentKindLabel(r.kind)}
                          {noReceipt && (
                            <span className="text-[var(--tone-warn)]"> · aucun reçu</span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="batta-tabular block text-[12.5px] text-foreground/90">
                          {formatTND(Number(r.amount) || 0, "fr")} TND
                        </span>
                        <span className="batta-tabular mt-0.5 block text-[11px] text-subtle">
                          {age(r.receipt_uploaded_at ?? r.created_at)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="shrink-0 border-t border-border px-4 py-2">
              <AdminPager page={page} totalPages={totalPages} />
            </div>
          )}
        </div>

        <div className={`min-w-0 flex-1 ${detail ? "flex" : "hidden lg:flex"}`}>
          {detail ? (
            <div className="w-full">
              <PaymentDetail payment={detail} backHref={listHref} />
            </div>
          ) : (
            <div className="grid w-full place-items-center px-6">
              <p className="max-w-xs text-center text-[12.5px] text-subtle">
                Choisissez un paiement à gauche.
                <br />
                <span className="text-[11.5px]">j / k pour parcourir, Entrée pour ouvrir.</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </FullBleed>
  );
}

function age(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "aujourd'hui";
  return `il y a ${days} j`;
}

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * One payment, everything the decision needs.
 *
 * The annonce is resolved through `metadata.listing_id` rather than a foreign
 * key: v3 fees never populated `payments.property_id`, which is also why the
 * `accept_listing_payment` RPC rejects every one of them.
 */
async function loadDetail(admin: Admin, id: string): Promise<PaymentDetailData | null> {
  const { data } = await admin
    .from("payments")
    .select(
      `id, kind, status, amount, provider, created_at, receipt_uploaded_at,
       reviewed_at, admin_notes, metadata, receipt_url, receipt_urls, user_id,
       payer:profiles!payments_user_id_fkey (full_name, phone)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const r = data as unknown as {
    id: string; kind: string; status: string; amount: number | string;
    provider: string; created_at: string; receipt_uploaded_at: string | null;
    reviewed_at: string | null; admin_notes: string | null;
    metadata: { listing_id?: string; product_id?: string } | null;
    receipt_url: string | null; receipt_urls: string[] | null;
    payer: { full_name: string | null; phone: string | null } | null;
  };

  const paths = [...new Set([...(r.receipt_urls ?? []), r.receipt_url].filter(Boolean))] as string[];

  // Signed URLs are minted with the user's client: the receipts bucket is
  // private, and a signed link is the only way the browser can render one.
  const sb = await getServerSupabase();
  const receipts: { url: string; path: string }[] = [];
  await Promise.all(
    paths.map(async (path) => {
      const { data: signed } = await sb.storage.from("receipts").createSignedUrl(path, 3600);
      if (signed?.signedUrl) receipts.push({ url: signed.signedUrl, path });
    }),
  );

  const [listingRes, productRes] = await Promise.all([
    r.metadata?.listing_id
      ? admin
          .from("listings")
          .select("id, title, status")
          .eq("id", r.metadata.listing_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    r.metadata?.product_id
      ? admin.from("products").select("name_fr").eq("id", r.metadata.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const listing = listingRes.data as { id: string; title: string; status: string } | null;

  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    amount: Number(r.amount) || 0,
    provider: r.provider,
    createdAt: r.created_at,
    uploadedAt: r.receipt_uploaded_at,
    reviewedAt: r.reviewed_at,
    adminNotes: r.admin_notes,
    sellerName: r.payer?.full_name ?? "Sans nom",
    sellerPhone: r.payer?.phone ?? null,
    productName: (productRes.data as { name_fr: string } | null)?.name_fr ?? null,
    listing,
    receipts,
  };
}
