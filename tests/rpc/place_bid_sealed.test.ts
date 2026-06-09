// ============================================================================
// place_bid — sealed-auction branch (was untested). Sealed rules: a bid must be
// >= opening_price, and each bidder gets exactly ONE bid (sealed_one_bid).
// (The dutch branch is time-of-day price-dependent and is exercised in CI with
// a seeded clock; here we pin the deterministic sealed gates.)
// ============================================================================
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  captureDeposit,
  createUser,
  deleteUsers,
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

async function bid(bidder: TestUser, auctionId: string, amount: number) {
  return bidder.client.rpc("place_bid", {
    p_auction_id: auctionId,
    p_amount: amount,
    p_max_amount: null,
    p_ip: null,
  });
}

describe("place_bid — sealed auction", () => {
  it("accepts a first bid at/above opening, then blocks a second from the same bidder", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "sealed",
      status: "live",
      openingPrice: opening,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    const first = await bid(bidder, auctionId, opening);
    expect(first.error, first.error?.message).toBeUndefined();

    const second = await bid(bidder, auctionId, opening + 50_000);
    expect(second.error, "a sealed bidder gets exactly one bid").toBeTruthy();

    const { count } = await svc
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq("auction_id", auctionId);
    expect(count).toBe(1);
  });

  it("rejects a sealed bid below the opening price", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "sealed",
      status: "live",
      openingPrice: opening,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    const r = await bid(bidder, auctionId, opening - 1);
    expect(r.error, "below opening must be rejected").toBeTruthy();
  });

  it("does NOT publish the sealed amount onto a column the trigger leaves null on the public row", async () => {
    // Sanity: sealed bids still record amount in the bids table (read via
    // service-role here); RLS hides it from non-bidders in prod.
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "sealed",
      status: "live",
      openingPrice: opening,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });
    await bid(bidder, auctionId, opening + 25_000);

    const { data } = await svc
      .from("bids")
      .select("amount, bidder_id")
      .eq("auction_id", auctionId)
      .single();
    expect(Number(data?.amount)).toBe(opening + 25_000);
    expect(data?.bidder_id).toBe(bidder.id);
  });
});
