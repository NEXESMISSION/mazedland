import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatTND } from "@/lib/utils";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Gavel, MapPin, Receipt, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TABS = [
  { value: "pending_review", label: "En attente" },
  { value: "captured", label: "Validés" },
  { value: "failed", label: "Refusés" },
  { value: "all", label: "Tous" },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["value"];
const PAGE_SIZE = 24; // auction boxes per page
const fmt = (n: number) => `${formatTND(n, "fr")} TND`;

/**
 * Paiements — entry receipts (caution / achat / solde) grouped into one
 * clickable BOX per auction. Clicking a box opens /admin/auctions/[id]
 * where the receipts are reviewed. The list itself stays light: no
 * per-receipt rows, no receipt-signing — just the per-lot summary.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; range?: string; page?: string }>;
}) {
  const { status: statusParam, q: qParam, range: rangeParam, page: pageParam } = await searchParams;
  const sb = await getServerSupabase();

  const status: StatusTab = STATUS_TABS.some((s) => s.value === statusParam) ? (statusParam as StatusTab) : "pending_review";
  const q = (qParam ?? "").trim().toLowerCase().slice(0, 60);
  const sinceDays = rangeParam === "1" || rangeParam === "7" || rangeParam === "30" ? Number(rangeParam) : null;
  const page = Math.max(1, Number(pageParam) || 1);

  // Group + filter + paginate in SQL (admin_payment_boxes RPC). The old path
  // pulled up to 5000 joined rows and grouped/sliced in Node — silently
  // truncating the admin money console past ~3k payments. Now SQL returns just
  // this page plus the true total.
  const { data, error } = await sb.rpc("admin_payment_boxes", {
    p_status: status,
    p_q: q || null,
    p_since_days: sinceDays,
    p_page: page,
    p_page_size: PAGE_SIZE,
  });
  const result = (data ?? { total: 0, boxes: [] }) as {
    total: number;
    boxes: { auction_id: string; title: string | null; gov: string | null; status: string | null; cnt: number; total: number; oldest: string | null }[];
  };
  const slice = (result.boxes ?? []).map((b) => ({
    auctionId: b.auction_id,
    title: b.title ?? "—",
    gov: b.gov ?? "",
    status: b.status ?? "",
    count: Number(b.cnt),
    total: Number(b.total),
    oldest: b.oldest,
  }));
  const total = Number(result.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <AdminPageHeader
        eyebrow="Enchères · Paiements"
        title="Paiements — caution, achat, solde"
        description="Une carte par enchère. Cliquez pour vérifier ses reçus."
      />

      <div className="mt-5 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const active = tab.value === status;
          return (
            <Link
              key={tab.value}
              href={(tab.value === "pending_review" ? "/admin/payments" : `/admin/payments?status=${tab.value}`) as "/admin/payments"}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors ${
                active ? "border-[var(--gold)] bg-[var(--gold)] text-white" : "border-border bg-surface text-muted hover:border-gold-soft"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <AdminQueryBar total={total} placeholder="Bien ou ville…" />

      {error && <div className="mt-4 rounded-xl border border-[var(--accent-soft)] bg-[var(--accent-faint)] p-4 text-sm font-medium text-[var(--accent-deep)]">{error.message}</div>}

      {slice.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          Aucun paiement dans cette vue.
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {slice.map((b) => (
            <Link
              key={b.auctionId}
              href={`/admin/auctions/${b.auctionId}`}
              className="group flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-gold-soft/60 hover:shadow-[0_12px_30px_-14px_rgba(30,58,138,0.35)]"
            >
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gold-faint text-gold">
                <Receipt className="size-5" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13.5px] font-bold text-foreground">
                  <Gavel className="size-3.5 shrink-0 text-gold" strokeWidth={2.2} />
                  <span className="truncate">{b.title}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <MapPin className="size-3" /> {b.gov}
                  <span aria-hidden className="opacity-40">·</span>
                  <span className="batta-tabular">{b.count} reçu{b.count > 1 ? "s" : ""} · {fmt(b.total)}</span>
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:text-gold" />
            </Link>
          ))}
        </div>
      )}

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
