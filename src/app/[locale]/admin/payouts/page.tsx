import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatTND } from "@/lib/utils";
import { PayoutRowActions } from "./PayoutRowActions";

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

const STATUS_TONE: Record<string, string> = {
  requested:  "batta-tone-warn",
  processing: "batta-tone-warn",
  paid:       "batta-tone-ok",
  rejected:   "batta-tone-bad",
};

/**
 * Admin payout queue. Lists withdrawal requests across all sellers,
 * filterable by status. Each row carries the action buttons (advance to
 * processing, mark paid, reject) wired to /api/admin/payouts/[id].
 *
 * The seller_payouts RLS lets admins read every row; the join to
 * profiles uses the same RLS path (admins can read all profiles).
 */
export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const locale = await getLocale();
  const supabase = await getServerSupabase();

  const status: StatusTab = STATUS_TABS.some((s) => s.value === statusParam)
    ? (statusParam as StatusTab)
    : "requested";

  let query = supabase
    .from("seller_payouts")
    .select(
      "id, seller_id, amount, status, iban, payment_method, reviewer_notes, processed_at, created_at, seller:profiles!seller_payouts_seller_id_fkey (id, full_name, phone)",
    );
  if (status !== "all") {
    query = query.eq("status", status);
  }
  // Requested oldest-first (FIFO work queue); history newest-first.
  query = query.order("created_at", { ascending: status === "requested" });

  const { data, error } = await query;
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
    seller:
      | { id: string; full_name: string | null; phone: string | null }
      | { id: string; full_name: string | null; phone: string | null }[]
      | null;
  };
  const rows = ((data ?? []) as unknown as RawRow[]).map((r) => ({
    ...r,
    seller: Array.isArray(r.seller) ? (r.seller[0] ?? null) : r.seller,
  }));

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
          {rows.length}
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
        <ul className="mt-5 space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {rows.map((p) => (
            <li
              key={p.id}
              className="rounded-xl bg-surface p-4 ring-1 ring-border"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold text-foreground truncate">
                    {p.seller?.full_name ?? "Vendeur"}
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-gold">
                    {p.seller_id.slice(0, 8)}…
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    Demandé le{" "}
                    {new Date(p.created_at).toLocaleString("fr-FR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {p.processed_at && (
                      <>
                        {" · Traité le "}
                        {new Date(p.processed_at).toLocaleString("fr-FR", {
                          dateStyle: "medium",
                        })}
                      </>
                    )}
                  </div>
                  {p.iban && (
                    <div className="mt-1 text-[11px] text-muted font-mono">
                      IBAN {p.iban}
                    </div>
                  )}
                  {p.seller?.phone && (
                    <div className="mt-1 text-[11px] text-muted">
                      Tél {p.seller.phone}
                    </div>
                  )}
                  {p.reviewer_notes && (
                    <div className="batta-tone-bad mt-2 rounded-md px-2 py-1 text-[10.5px]">
                      <span className="font-bold uppercase tracking-wider">Motif :</span>{" "}
                      {p.reviewer_notes}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="batta-tabular text-[18px] font-extrabold gradient-gold-text">
                    {formatTND(Number(p.amount), locale)}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${
                      STATUS_TONE[p.status] ?? "bg-surface-2 text-muted ring-1 ring-border"
                    }`}
                  >
                    {STATUS_TABS.find((t) => t.value === p.status)?.label ?? p.status}
                  </span>
                </div>
              </div>
              <div aria-hidden className="batta-hairline mt-3" />
              <div className="mt-3 flex justify-end">
                <PayoutRowActions id={p.id} status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
