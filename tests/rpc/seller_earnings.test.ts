// ============================================================================
// seller_earnings — a sale must credit the seller EXACTLY ONCE.
//
// The function (migrations 0089 → 0094 → 0096) is the heart of the money model:
// seller_balance sums its net_amount, and request_payout reserves against that
// sum. Any double-credit here is real money over-paid. These tests pin the four
// de-dup invariants the audit flagged:
//   (a) a clean win: deposit_lock (kept) + final_payment (balance) == price ONCE
//   (b) 0094: forfeit → re-enter → win credits the deposit ONCE (two captured
//       deposit_lock rows exist, only the latest active one counts)
//   (c) 0096: buy_now + a stray final_payment for the same winner counts ONCE
//   (d) a STRANDED buy_now (auction won by a higher bidder, close no-op'd):
//       credits 0 — the buyer's captured payment is excluded by the
//       winner_user_id == payer gate.
//
// seller_earnings reads auth.uid(), so it is called through the SELLER's own
// signed-in client. Fixtures are seeded via service-role (RLS + payment guards
// off), exactly mirroring the admin/manual-payment capture path in prod.
// ============================================================================
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  captureDeposit,
  capturePurchase,
  createUser,
  deleteUsers,
  forfeitDeposit,
  getAuction,
  netForAuction,
  requireEnv,
  rowsForAuction,
  seedAuction,
  setAuction,
  type TestUser,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const COMMISSION = 0.05; // batta_commission_rate() default
const net = (gross: number) => gross * (1 - COMMISSION);

let svc: SupabaseClient;
const created: TestUser[] = [];

beforeAll(() => {
  requireEnv();
  svc = admin();
});

afterEach(async () => {
  await deleteUsers(svc, created.splice(0));
});

async function newUser(opts: Parameters<typeof createUser>[1] = {}) {
  const u = await createUser(svc, opts);
  created.push(u);
  return u;
}

/** Call seller_earnings as the seller themselves. */
async function earningsAsSeller(seller: TestUser) {
  const { data, error } = await seller.client.rpc("seller_earnings", {
    p_seller_id: seller.id,
  });
  if (error) throw new Error(`seller_earnings rpc failed: ${error.message}`);
  return (data ?? []) as Array<{
    auction_id: string;
    kind: string;
    gross_amount: number | string;
    net_amount: number | string;
  }>;
}

describe("seller_earnings — credits a sale exactly once", () => {
  it("(a) deposit_lock + final_payment for a clean win counts the price ONCE", async () => {
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });

    const price = 100_000;
    const deposit = 10_000; // 10% caution, kept as part of the purchase
    const balance = price - deposit; // final_payment covers the remainder

    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: price,
    });

    // Winner locks a deposit (materializes auction_deposits via the trigger).
    await captureDeposit(svc, { userId: winner.id, auctionId, amount: deposit });

    // Auction closes with this bidder as winner at the full price.
    await setAuction(svc, auctionId, {
      status: "ended_sold",
      winner_user_id: winner.id,
      winner_amount: price,
      current_price: price,
    });

    // Final payment captures the balance (deposit stays locked = part of price).
    const res = await capturePurchase(svc, {
      userId: winner.id,
      auctionId,
      amount: balance,
      kind: "final_payment",
    });
    expect(res.error, res.error).toBeUndefined();

    const rows = await earningsAsSeller(seller);
    // Two LINE ITEMS (deposit_lock kept + final_payment balance) ...
    expect(rowsForAuction(rows, auctionId)).toBe(2);
    // ... but the GROSS they sum to is exactly one hammer price, no more.
    const gross = rows
      .filter((r) => r.auction_id === auctionId)
      .reduce((s, r) => s + Number(r.gross_amount), 0);
    expect(gross).toBeCloseTo(price, 2);
    expect(netForAuction(rows, auctionId)).toBeCloseTo(net(price), 2);
  });

  it("(b) 0094: forfeit → re-enter → win credits the deposit ONCE", async () => {
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });

    const price = 200_000;
    const deposit = 20_000;
    const balance = price - deposit;

    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: price,
    });

    // First deposit, then forfeit it (e.g. missed a prior obligation).
    await captureDeposit(svc, { userId: winner.id, auctionId, amount: deposit });
    await forfeitDeposit(svc, { userId: winner.id, auctionId });

    // Re-enter: a SECOND captured deposit_lock row. The trigger's ON CONFLICT
    // re-activates the single auction_deposits row (clears forfeited_at), but
    // the PAYMENTS ledger now holds TWO captured deposit_lock rows.
    await captureDeposit(svc, { userId: winner.id, auctionId, amount: deposit });

    await setAuction(svc, auctionId, {
      status: "ended_sold",
      winner_user_id: winner.id,
      winner_amount: price,
      current_price: price,
    });
    await capturePurchase(svc, {
      userId: winner.id,
      auctionId,
      amount: balance,
      kind: "final_payment",
    });

    const rows = await earningsAsSeller(seller);
    const depositRows = rows.filter(
      (r) => r.auction_id === auctionId && r.kind === "deposit_lock",
    );
    // Exactly ONE deposit_lock line item despite two captured rows.
    expect(depositRows.length).toBe(1);
    // Total gross is still one price (deposit-once + balance), not price+deposit.
    const gross = rows
      .filter((r) => r.auction_id === auctionId)
      .reduce((s, r) => s + Number(r.gross_amount), 0);
    expect(gross).toBeCloseTo(price, 2);
  });

  it("(c) 0096: buy_now + a stray final_payment for the same winner counts ONCE", async () => {
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });

    const opening = 100_000;
    const buyNow = 150_000;

    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
      buyNowPrice: buyNow,
    });

    // Buy-now capture closes the lot (winner = buyer, price = buy_now).
    const bn = await capturePurchase(svc, {
      userId: winner.id,
      auctionId,
      amount: buyNow,
      kind: "buy_now",
    });
    expect(bn.error, bn.error).toBeUndefined();

    const a1 = await getAuction(svc, auctionId);
    expect(a1.status).toBe("ended_sold");
    expect(a1.winner_user_id).toBe(winner.id);

    // A stray final_payment for the SAME winner+auction also captures (the 0084
    // unique index keys on kind, so a different kind does not collide).
    const fp = await capturePurchase(svc, {
      userId: winner.id,
      auctionId,
      amount: buyNow,
      kind: "final_payment",
    });
    expect(fp.error, fp.error).toBeUndefined();

    const rows = await earningsAsSeller(seller);
    // ONLY the buy_now line item counts; the final_payment is excluded.
    const auctionRows = rows.filter((r) => r.auction_id === auctionId);
    expect(auctionRows.length).toBe(1);
    expect(auctionRows[0].kind).toBe("buy_now");
    expect(netForAuction(rows, auctionId)).toBeCloseTo(net(buyNow), 2);
  });

  it("(d) a stranded buy_now (won by a higher bidder) credits 0 and is excluded", async () => {
    const seller = await newUser();
    const higherBidder = await newUser({ kyc: "verified" });
    const lateBuyer = await newUser({ kyc: "verified" });

    const opening = 100_000;
    const buyNow = 150_000;
    const standingHigh = 160_000; // already exceeds buy_now_price

    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
      buyNowPrice: buyNow,
      // A standing bid already met/exceeded buy_now → buy-now is retired.
      currentPrice: standingHigh,
    });

    // The lateBuyer's buy_now captures. close_auction_on_purchase no-ops
    // (high_bid_exceeds_buynow) — the buyer never becomes winner, but the
    // payment row is real ("captured") and owed back out-of-band.
    const bn = await capturePurchase(svc, {
      userId: lateBuyer.id,
      auctionId,
      amount: buyNow,
      kind: "buy_now",
    });
    expect(bn.error, bn.error).toBeUndefined();

    const aMid = await getAuction(svc, auctionId);
    // The close was a no-op: auction is still live, lateBuyer is NOT the winner.
    expect(aMid.status).toBe("live");
    expect(aMid.winner_user_id).toBeNull();

    // The higher bidder legitimately wins (tick/close would set this).
    await setAuction(svc, auctionId, {
      status: "ended_sold",
      winner_user_id: higherBidder.id,
      winner_amount: standingHigh,
      current_price: standingHigh,
    });

    const rows = await earningsAsSeller(seller);
    // The captured-but-stranded buy_now (payer != winner) is excluded entirely.
    expect(netForAuction(rows, auctionId)).toBeCloseTo(0, 2);
    expect(rowsForAuction(rows, auctionId)).toBe(0);
  });
});
