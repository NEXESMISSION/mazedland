import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { DepositsClient, type DepositRow, type PrepareRow, type HeldRow } from "./DepositsClient";
import { AdminPager } from "@/components/admin/AdminPager";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ENDED = ["ended_sold", "ended_unsold", "awarded", "cancelled"];
const PAGE_SIZE = 120;

type RawDeposit = {
  id: string;
  amount: number;
  refunded_at: string | null;
  refund_ref: string | null;
  created_at: string;
  user_id: string;
  payment_id: string | null;
  auction: {
    id: string;
    status: string;
    winner_user_id: string | null;
    property: { title: string; governorate: string } | null;
  } | null;
};

const SELECT = `
  id, amount, refunded_at, refund_ref, created_at, user_id, payment_id,
  auction:auctions!auction_deposits_auction_id_fkey (
    id, status, winner_user_id,
    property:properties ( title, governorate )
  )
`;
// Inner-joined variant — lets us filter the to-refund queue server-side by
// property title (the embed must be !inner for the filter to drop parent rows).
const SELECT_INNER = `
  id, amount, refunded_at, refund_ref, created_at, user_id, payment_id,
  auction:auctions!auction_deposits_auction_id_fkey!inner (
    id, status, winner_user_id,
    property:properties!inner ( title, governorate )
  )
`;

export default async function AdminDepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; range?: string; page?: string }>;
}) {
  const { q: qParam, range: rangeParam, page: pageParam } = await searchParams;
  const supabase = await getServerSupabase();
  const q = (qParam ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const sinceDays = rangeParam === "1" || rangeParam === "7" || rangeParam === "30" ? Number(rangeParam) : null;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // ─── 1. TO-REFUND — the only unbounded queue: server-paginated + counted
  //     (was a flat .limit(300) that silently dropped rows past the cap).
  //     Search now runs server-side over the WHOLE queue (was a client
  //     filter that only saw the loaded page slice). ───
  let refundQuery = supabase
    .from("auction_deposits")
    .select(q ? SELECT_INNER : SELECT, { count: "exact" })
    .not("released_at", "is", null)
    .is("refunded_at", null)
    .is("forfeited_at", null);
  if (q) refundQuery = refundQuery.ilike("auction.property.title", `%${q}%`);
  if (sinceDays) refundQuery = refundQuery.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  const { data: refundRows, count } = await refundQuery
    .order("created_at", { ascending: false })
    .range(from, to);
  const toRefundRaw = (refundRows ?? []) as unknown as RawDeposit[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─── 2. recent refunds (bounded) ───
  const { data: refundedRows } = await supabase
    .from("auction_deposits")
    .select(SELECT)
    .not("refunded_at", "is", null)
    .order("refunded_at", { ascending: false })
    .limit(20);
  const refundedRaw = (refundedRows ?? []) as unknown as RawDeposit[];

  // ─── 3. bidder names for both sets (batched) ───
  const userIds = Array.from(
    new Set([...toRefundRaw, ...refundedRaw].map((d) => d.user_id)),
  );
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profs ?? []) if (p.full_name) names.set(p.id as string, p.full_name as string);
  }

  // ─── 4. signed receipts for the current to-refund page slice ───
  const receiptByPayment = new Map<string, string>();
  const payIds = toRefundRaw.map((d) => d.payment_id).filter(Boolean) as string[];
  if (payIds.length > 0) {
    const { data: pays } = await supabase
      .from("payments").select("id, receipt_url").in("id", payIds);
    await Promise.all(
      (pays ?? []).map(async (p) => {
        if (!p.receipt_url) return;
        const { data: s } = await supabase.storage
          .from("receipts").createSignedUrl(p.receipt_url as string, 3600);
        if (s?.signedUrl) receiptByPayment.set(p.id as string, s.signedUrl);
      }),
    );
  }

  const toRow = (d: RawDeposit): DepositRow => ({
    id: d.id,
    amount: Number(d.amount),
    bidder: names.get(d.user_id) ?? "Acheteur",
    auctionId: d.auction?.id ?? null,
    status: d.auction?.status ?? "",
    title: d.auction?.property?.title ?? "—",
    governorate: d.auction?.property?.governorate ?? "",
    refundRef: d.refund_ref,
    refundedAt: d.refunded_at,
    receiptUrl: d.payment_id ? receiptByPayment.get(d.payment_id) ?? null : null,
  });

  const toRefund = toRefundRaw.map(toRow);
  const refunded = refundedRaw.map(toRow);

  // ─── 5. auctions that ended but still hold locked non-winner deposits
  //     → "prepare refunds" pass. Bounded scan, grouped by auction. ───
  const { data: lockedRows } = await (getServiceSupabase() ?? supabase)
    .from("auction_deposits")
    .select(`auction_id, user_id, auction:auctions!auction_deposits_auction_id_fkey ( id, status, winner_user_id, sixth_offer_deadline, property:properties ( title ) )`)
    .is("released_at", null)
    .is("refunded_at", null)
    .is("forfeited_at", null)
    .limit(1000);
  const prepareMap = new Map<string, PrepareRow>();
  const heldMap = new Map<string, HeldRow>();
  for (const d of (lockedRows ?? []) as unknown as Array<{
    user_id: string;
    auction: { id: string; status: string; winner_user_id: string | null; sixth_offer_deadline: string | null; property: { title: string } | null } | null;
  }>) {
    const a = d.auction;
    if (!a) continue;
    // Lots still inside the legal 1/6 surenchère window: cautions stay
    // locked (a bidder may still surenchère) but we surface them so the
    // admin can see they exist and when they'll free up — they become
    // refundable automatically once the window closes (→ awarded).
    if (a.status === "sixth_offer_window") {
      const cur = heldMap.get(a.id) ?? {
        auctionId: a.id, title: a.property?.title ?? "—", deadline: a.sixth_offer_deadline, lockedCount: 0,
      };
      cur.lockedCount += 1;
      heldMap.set(a.id, cur);
      continue;
    }
    if (!ENDED.includes(a.status)) continue;
    if (a.winner_user_id && d.user_id === a.winner_user_id) continue;
    const cur = prepareMap.get(a.id) ?? {
      auctionId: a.id, title: a.property?.title ?? "—", status: a.status, lockedCount: 0,
    };
    cur.lockedCount += 1;
    prepareMap.set(a.id, cur);
  }
  const toPrepare = Array.from(prepareMap.values());
  const held = Array.from(heldMap.values());

  return (
    <div>
      <AdminPageHeader
        eyebrow="Cautions & remboursements"
        title="Remboursements"
        description={
          <>
            Après une enchère : préparez les remboursements, puis marquez chaque
            caution remboursée une fois le virement effectué.{" "}
            <span className="batta-tabular font-semibold text-foreground">{total}</span>{" "}
            caution{total > 1 ? "s" : ""} à rembourser.
          </>
        }
      />

      <AdminQueryBar total={total} placeholder="Bien (titre)…" />

      <DepositsClient
        toPrepare={toPrepare}
        held={held}
        toRefund={toRefund}
        refunded={refunded}
        filtering={Boolean(q || sinceDays)}
      />

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
