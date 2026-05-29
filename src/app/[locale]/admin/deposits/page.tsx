import { getServerSupabase } from "@/lib/supabase/server";
import { DepositsClient, type DepositRow, type PrepareRow } from "./DepositsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ENDED = ["ended_sold", "ended_unsold", "awarded", "cancelled"];

type RawDeposit = {
  id: string;
  amount: number;
  released_at: string | null;
  refunded_at: string | null;
  forfeited_at: string | null;
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

export default async function AdminDepositsPage() {
  const supabase = await getServerSupabase();

  const { data } = await supabase
    .from("auction_deposits")
    .select(`
      id, amount, released_at, refunded_at, forfeited_at, refund_ref, created_at, user_id, payment_id,
      auction:auctions!auction_deposits_auction_id_fkey (
        id, status, winner_user_id,
        property:properties ( title, governorate )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(300);
  const deposits = (data ?? []) as unknown as RawDeposit[];

  // Bidder names (batched — avoid FK-embed pitfalls).
  const userIds = Array.from(new Set(deposits.map((d) => d.user_id)));
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profs ?? []) if (p.full_name) names.set(p.id as string, p.full_name as string);
  }

  // Signed receipts for the to-refund queue (proof the bidder paid).
  const toRefundRaw = deposits.filter(
    (d) => d.released_at && !d.refunded_at && !d.forfeited_at,
  );
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
  const refunded = deposits
    .filter((d) => d.refunded_at)
    .slice(0, 30)
    .map(toRow);

  // Auctions that ended but still have locked non-winner deposits → need a
  // "prepare refunds" pass. Group locked deposits by auction.
  const prepareMap = new Map<string, PrepareRow>();
  for (const d of deposits) {
    const a = d.auction;
    if (!a || !ENDED.includes(a.status)) continue;
    const locked = !d.released_at && !d.refunded_at && !d.forfeited_at;
    const isWinner = a.winner_user_id && d.user_id === a.winner_user_id;
    if (!locked || isWinner) continue;
    const cur = prepareMap.get(a.id) ?? {
      auctionId: a.id,
      title: a.property?.title ?? "—",
      status: a.status,
      lockedCount: 0,
    };
    cur.lockedCount += 1;
    prepareMap.set(a.id, cur);
  }
  const toPrepare = Array.from(prepareMap.values());

  return (
    <div>
      <span className="batta-eyebrow">Cautions &amp; remboursements</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Cautions
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Après une enchère : préparez les remboursements, puis marquez chaque
        caution remboursée une fois le virement effectué.
      </p>

      <DepositsClient
        toPrepare={toPrepare}
        toRefund={toRefund}
        refunded={refunded}
      />
    </div>
  );
}
