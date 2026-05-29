import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { PayoutsList } from "./PayoutsList";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TABS = [
  { value: "requested",  label: "En attente"   },
  { value: "processing", label: "En traitement" },
  { value: "paid",       label: "Payés"        },
  { value: "rejected",   label: "Refusés"      },
  { value: "all",        label: "Tous"         },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["value"];

/**
 * Admin payout queue. Lists withdrawal requests across all sellers,
 * filterable by status. Each row carries the action buttons (advance to
 * processing, mark paid, reject) wired to /api/admin/payouts/[id].
 *
 * The seller_payouts RLS lets admins read every row; the join to
 * profiles uses the same RLS path (admins can read all profiles).
 */
const PAGE_SIZE = 24;

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; range?: string; page?: string; mine?: string }>;
}) {
  const { status: statusParam, q: qParam, range: rangeParam, page: pageParam, mine: mineParam } =
    await searchParams;
  const locale = await getLocale();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const meId = user?.id ?? null;

  const status: StatusTab = STATUS_TABS.some((s) => s.value === statusParam)
    ? (statusParam as StatusTab)
    : "requested";
  const q = (qParam ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const sinceDays = rangeParam === "1" || rangeParam === "7" || rangeParam === "30"
    ? Number(rangeParam) : null;
  const mine = mineParam === "1" && !!meId;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("seller_payouts")
    .select(
      `id, seller_id, amount, status, iban, payment_method, reviewer_notes, processed_at, created_at, claimed_by, claimed_at, seller:profiles!seller_payouts_seller_id_fkey${q ? "!inner" : ""} (id, full_name, phone), claimer:profiles!seller_payouts_claimed_by_fkey (full_name)`,
      { count: "exact" },
    );
  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (mine && meId) query = query.eq("claimed_by", meId);
  if (q) query = query.ilike("seller.full_name", `%${q}%`);
  if (sinceDays) {
    query = query.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  }
  // Requested oldest-first (FIFO work queue); history newest-first.
  query = query.order("created_at", { ascending: status === "requested" }).range(from, to);

  const { data, error, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // PostgREST returns embedded relations as arrays (Supabase types it
  // that way even for many-to-one FKs). We map it down to a single
  // object so the JSX below can use `p.seller?.full_name` without
  // worrying about the array shape.
  type RawRow = {
    id: string;
    seller_id: string;
    amount: number;
    status: "requested" | "processing" | "paid" | "rejected";
    iban: string | null;
    payment_method: string;
    reviewer_notes: string | null;
    processed_at: string | null;
    created_at: string;
    claimed_by: string | null;
    claimed_at: string | null;
    seller:
      | { id: string; full_name: string | null; phone: string | null }
      | { id: string; full_name: string | null; phone: string | null }[]
      | null;
    claimer: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const rows = ((data ?? []) as unknown as RawRow[]).map((r) => {
    const claimer = Array.isArray(r.claimer) ? r.claimer[0] : r.claimer;
    return {
      id: r.id,
      seller_id: r.seller_id,
      amount: r.amount,
      status: r.status,
      iban: r.iban,
      payment_method: r.payment_method,
      reviewer_notes: r.reviewer_notes,
      processed_at: r.processed_at,
      created_at: r.created_at,
      seller: Array.isArray(r.seller) ? (r.seller[0] ?? null) : r.seller,
      claimed_by: r.claimed_by,
      claimed_by_name: claimer?.full_name ?? null,
    };
  });

  return (
    <div>
      <span className="batta-eyebrow">Argent · Vendeurs</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">
          Paiements vendeurs
        </h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${
            status === "requested"
              ? "batta-tone-warn"
              : "bg-surface-2 text-muted ring-1 ring-border"
          }`}
        >
          {total}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Approuver, traiter et confirmer les retraits demandés par les vendeurs.
        Les montants déjà déduits de la commission Batta (5%).
      </p>

      {/* Tabs */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const active = tab.value === status;
          return (
            <Link
              key={tab.value}
              href={
                (tab.value === "requested"
                  ? "/admin/payouts"
                  : `/admin/payouts?status=${tab.value}`) as `/admin/payouts`
              }
              className={`px-3 h-8 inline-flex items-center rounded-full text-xs font-bold border transition-colors ${
                active
                  ? "bg-[var(--gold)] text-black border-[var(--gold)]"
                  : "bg-[var(--surface)] text-[var(--foreground-muted)] border-[var(--border)] hover:border-[var(--gold-soft)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {(status === "requested" || status === "processing") && meId && (
        <div className="mt-2">
          <Link
            href={(mine
              ? `/admin/payouts${status === "requested" ? "" : `?status=${status}`}`
              : `/admin/payouts?${status === "requested" ? "" : `status=${status}&`}mine=1`) as `/admin/payouts`}
            className={`inline-flex h-7 items-center rounded-full px-3 text-[11px] font-bold transition-colors ${
              mine ? "bg-gold-faint text-gold ring-1 ring-gold/30" : "text-muted hover:text-foreground"
            }`}
          >
            Mes réservations
          </Link>
        </div>
      )}

      <AdminQueryBar total={total} placeholder="Vendeur (nom)…" />

      {error && (
        <div className="mt-4 rounded-[var(--radius-md)] bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          {status === "requested"
            ? "Aucune demande en attente."
            : "Aucun retrait dans cette vue."}
        </div>
      ) : (
        <PayoutsList rows={rows} status={status} locale={locale} meId={meId} />
      )}

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
