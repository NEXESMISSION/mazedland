import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { PaymentsQueueList, type PaymentReviewItem } from "./PaymentsQueueList";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TABS = [
  { value: "pending_review", label: "En attente" },
  { value: "captured", label: "Validés" },
  { value: "failed", label: "Refusés" },
  { value: "all", label: "Tous" },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["value"];

const KIND_LABELS: Record<string, string> = {
  deposit_lock: "Caution",
  buy_now: "Achat",
  final_payment: "Paiement final",
  commission: "Commission",
  inspection_fee: "Inspection",
  subscription: "Abonnement",
  deposit_release: "Remboursement",
  listing_fee: "Annonce + options",
};

/**
 * Admin payments review queue. Lists `payments` filtered by status,
 * with signed URLs for each receipt so the admin can render them.
 *
 * Receipts live in the private `receipts` bucket; we mint 60-min
 * signed URLs server-side so the admin sees the proof inline without
 * exposing storage paths to the browser.
 */
const PAGE_SIZE = 24;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; range?: string; page?: string }>;
}) {
  const { status: statusParam, q: qParam, range: rangeParam, page: pageParam } =
    await searchParams;
  const supabase = await getServerSupabase();

  const status: StatusTab = STATUS_TABS.some((s) => s.value === statusParam)
    ? (statusParam as StatusTab)
    : "pending_review";
  const q = (qParam ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const sinceDays = rangeParam === "1" || rangeParam === "7" || rangeParam === "30"
    ? Number(rangeParam) : null;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const dateCol = status === "pending_review" ? "receipt_uploaded_at" : "reviewed_at";

  let query = supabase
    .from("payments")
    .select(
      `id, user_id, kind, provider, amount, status, receipt_url,
       receipt_uploaded_at, admin_notes, reviewed_at, auction_id, property_id, metadata,
       buyer:profiles!payments_user_id_fkey${q ? "!inner" : ""} (full_name, phone),
       auction:auctions (id, property:properties (title, governorate)),
       property:properties!payments_property_id_fkey (id, title, governorate)`,
      { count: "exact" },
    );

  if (status !== "all") {
    query = query.eq("status", status);
  } else {
    query = query.in("status", ["pending_review", "captured", "failed"]);
  }
  // Entry payments only — the listing-fee receipt (paid to CREATE an
  // auction) is reviewed on "Création d'enchères", not here.
  query = query.in("kind", ["deposit_lock", "buy_now", "final_payment"]);
  if (q) query = query.ilike("buyer.full_name", `%${q}%`);
  if (sinceDays) {
    query = query.gte(dateCol, new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  }
  query = query
    .order(dateCol, { ascending: status === "pending_review" })
    .range(from, to);

  const { data, error, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  type Row = {
    id: string;
    user_id: string;
    kind: string;
    provider: string;
    amount: number;
    status: string;
    receipt_url: string | null;
    receipt_uploaded_at: string | null;
    admin_notes: string | null;
    reviewed_at: string | null;
    auction_id: string | null;
    property_id: string | null;
    metadata: Record<string, unknown> | null;
    buyer: { full_name: string | null; phone: string | null } | null;
    auction: {
      id: string;
      property: { title: string; governorate: string } | null;
    } | null;
    property: { id: string; title: string; governorate: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const items: PaymentReviewItem[] = await Promise.all(
    rows.map(async (row) => {
      let receiptSignedUrl: string | null = null;
      if (row.receipt_url) {
        const { data: signed } = await supabase.storage
          .from("receipts")
          .createSignedUrl(row.receipt_url, 3600);
        receiptSignedUrl = signed?.signedUrl ?? null;
      }
      const promosObj = (row.metadata as { promos?: Record<string, boolean> } | null)?.promos ?? null;
      const promos = promosObj
        ? {
            homeFeatured: !!promosObj.home_featured,
            topListed: !!promosObj.top_listed,
            banner: !!promosObj.banner,
          }
        : null;
      return {
        id: row.id,
        userId: row.user_id,
        buyerName: row.buyer?.full_name ?? null,
        buyerPhone: row.buyer?.phone ?? null,
        kind: row.kind,
        kindLabel: KIND_LABELS[row.kind] ?? row.kind,
        provider: row.provider,
        amount: Number(row.amount),
        status: row.status,
        receiptUrl: receiptSignedUrl,
        receiptPath: row.receipt_url,
        receiptUploadedAt: row.receipt_uploaded_at,
        adminNotes: row.admin_notes,
        reviewedAt: row.reviewed_at,
        auctionId: row.auction_id,
        propertyId: row.property_id ?? row.property?.id ?? null,
        propertyTitle:
          row.auction?.property?.title ?? row.property?.title ?? null,
        propertyGovernorate:
          row.auction?.property?.governorate ?? row.property?.governorate ?? null,
        promos,
      };
    }),
  );

  return (
    <div>
      <span className="batta-eyebrow">Enchères · Paiements</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">
          Paiements — caution, achat, solde
        </h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${
            status === "pending_review"
              ? "batta-tone-warn"
              : "bg-surface-2 text-muted ring-1 ring-border"
          }`}
        >
          {items.length}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Vérifiez chaque reçu (virement bancaire ou D17). Validez pour
        déclencher les effets en aval (caution, clôture d&apos;enchère).
        Refusez avec un motif clair — l&apos;acheteur reçoit une
        notification.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const active = tab.value === status;
          return (
            <Link
              key={tab.value}
              href={
                (tab.value === "pending_review"
                  ? "/admin/payments"
                  : `/admin/payments?status=${tab.value}`) as `/admin/payments`
              }
              className={`px-3 h-8 inline-flex items-center rounded-full text-xs font-bold border transition-colors ${
                active
                  ? "bg-[var(--gold)] text-white border-[var(--gold)]"
                  : "bg-[var(--surface)] text-[var(--foreground-muted)] border-[var(--border)] hover:border-[var(--gold-soft)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <AdminQueryBar total={total} placeholder="Acheteur (nom)…" />

      {error && (
        <div className="mt-4 rounded-[var(--radius-md)] bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {items.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          {status === "pending_review"
            ? "Aucun reçu en attente."
            : "Aucun paiement dans cette vue."}
        </div>
      ) : (
        <div className="mt-5">
          <PaymentsQueueList items={items} view={status} />
          <AdminPager page={page} totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}
