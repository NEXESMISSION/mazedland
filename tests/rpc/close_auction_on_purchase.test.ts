// ============================================================================
// close_auction_on_purchase — the atomic buy-now / direct-sale close
// (migrations 0019 → 0079 → 0085).
//
// Asserts the three behaviours the audit cares about:
//   * NO-OP {ok:false, high_bid_exceeds_buynow} when a standing bid already
//     met/exceeded buy_now_price (must NOT undercut the higher bidder).
//   * NO-OP {ok:false, already_closed} when the auction is already terminal
//     (ended_sold / sixth_offer_window) — idempotent, never rolls back.
//   * On a clean buy-now: sets winner + ended_sold, and validates that
//     (amount + active deposit) ≈ buy_now_price (rejects amount_mismatch).
//
// The RPC is called directly (granted to service_role) so we observe the exact
// return JSON. Fixtures via service-role.
// ============================================================================
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  captureDeposit,
  createUser,
  deleteUsers,
  getAuction,
  requireEnv,
  seedAuction,
  type TestUser,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Call the RPC directly via service-role and return its JSON result. */
async function close(auctionId: string, buyerId: string, amount: number) {
  const { data, error } = await svc.rpc("close_auction_on_purchase", {
    p_auction_id: auctionId,
    p_buyer_id: buyerId,
    p_amount: amount,
  });
  return { data: data as Record<string, unknown> | null, error };
}

describe("close_auction_on_purchase", () => {
  it("no-ops (ok:false) when a standing bid >= buy_now_price", async () => {
    const seller = await newUser();
    const buyer = await newUser({ kyc: "verified" });
    const buyNow = 150_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: 100_000,
      buyNowPrice: buyNow,
      currentPrice: 160_000, // a higher standing bid retires buy-now
    });

    const { data, error } = await close(auctionId, buyer.id, buyNow);
    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.reason).toBe("high_bid_exceeds_buynow");

    // Auction untouched — still live, no winner.
    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("live");
    expect(a.winner_user_id).toBeNull();
  });

  it("no-ops (ok:false, already_closed) when the auction is terminal", async () => {
    const seller = await newUser();
    const buyer = await newUser({ kyc: "verified" });
    const buyNow = 150_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "ended_sold", // already terminal
      openingPrice: 100_000,
      buyNowPrice: buyNow,
    });

    const { data, error } = await close(auctionId, buyer.id, buyNow);
    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.reason).toBe("already_closed");
    expect(data?.status).toBe("ended_sold");
  });

  it("no-ops on sixth_offer_window (does not roll back a stale capture)", async () => {
    const seller = await newUser();
    const buyer = await newUser({ kyc: "verified" });
    const buyNow = 150_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "sixth_offer_window",
      openingPrice: 100_000,
      buyNowPrice: buyNow,
    });

    const { data, error } = await close(auctionId, buyer.id, buyNow);
    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.reason).toBe("already_closed");
  });

  it("on a clean buy-now: sets winner + ended_sold and validates amount≈price", async () => {
    const seller = await newUser();
    const buyer = await newUser({ kyc: "verified" });
    const buyNow = 150_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: 100_000,
      buyNowPrice: buyNow,
    });

    const { data, error } = await close(auctionId, buyer.id, buyNow);
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(Number(data?.price)).toBeCloseTo(buyNow, 2);

    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("ended_sold");
    expect(a.winner_user_id).toBe(buyer.id);
    expect(Number(a.winner_amount)).toBeCloseTo(buyNow, 2);
  });

  it("validates amount + active deposit ≈ buy_now_price (netting)", async () => {
    const seller = await newUser();
    const buyer = await newUser({ kyc: "verified" });
    const buyNow = 150_000;
    const deposit = 15_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: 100_000,
      buyNowPrice: buyNow,
    });
    // Buyer has an active deposit → buy-now charge is netted to (price - deposit).
    await captureDeposit(svc, { userId: buyer.id, auctionId, amount: deposit });

    // The NETTED amount (balance) + the locked deposit must total buy_now_price.
    const balance = buyNow - deposit;
    const ok = await close(auctionId, buyer.id, balance);
    expect(ok.error).toBeNull();
    expect(ok.data?.ok).toBe(true);
    // The recorded hammer price is the FULL price, not the netted charge.
    expect(Number(ok.data?.price)).toBeCloseTo(buyNow, 2);
  });

  it("rejects amount_mismatch when amount + deposit != price", async () => {
    const seller = await newUser();
    const buyer = await newUser({ kyc: "verified" });
    const buyNow = 150_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: 100_000,
      buyNowPrice: buyNow,
    });

    // No deposit, but pay far less than buy_now_price → amount_mismatch.
    const { data, error } = await close(auctionId, buyer.id, 100_000);
    expect(data).toBeNull();
    expect(error?.message).toContain("amount_mismatch");

    // Auction left untouched (the raise rolled the txn back).
    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("live");
    expect(a.winner_user_id).toBeNull();
  });
});
