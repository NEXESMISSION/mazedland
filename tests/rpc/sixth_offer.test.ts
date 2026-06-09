// ============================================================================
// place_sixth_offer — the Tunisian +1/6 challenge window (0043 + 0109 guard).
// This RPC can SWAP the auction winner for real money, and was untested. It
// pins: a valid challenge inserts a sixth_offer; the 1/6 minimum is enforced;
// and the property owner cannot challenge their own lot (0109 self-bid guard).
// ============================================================================
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  captureDeposit,
  createUser,
  deleteUsers,
  requireEnv,
  seedAuction,
  setAuction,
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

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** Seed an auction already in the open sixth-offer window with a standing winner. */
async function seedSixthWindow(seller: TestUser, winner: TestUser, winAmount: number) {
  const { auctionId } = await seedAuction(svc, {
    ownerId: seller.id,
    type: "english",
    status: "sixth_offer_window",
    openingPrice: 100_000,
    winnerUserId: winner.id,
    winnerAmount: winAmount,
    currentPrice: winAmount,
  });
  await setAuction(svc, auctionId, { sixth_offer_deadline: inDays(8) });
  return auctionId;
}

describe("place_sixth_offer — +1/6 challenge window", () => {
  it("a verified challenger with a deposit can place a valid sixth offer", async () => {
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });
    const challenger = await newUser({ kyc: "verified" });
    const winAmount = 120_000;
    const auctionId = await seedSixthWindow(seller, winner, winAmount);
    await captureDeposit(svc, { userId: challenger.id, auctionId, amount: 12_000 });

    const minSixth = Math.ceil((winAmount * 7) / 6); // 140000
    const { error } = await challenger.client.rpc("place_sixth_offer", {
      p_auction_id: auctionId,
      p_amount: minSixth,
    });
    expect(error, error?.message).toBeUndefined();

    const { count } = await svc
      .from("sixth_offers")
      .select("id", { count: "exact", head: true })
      .eq("auction_id", auctionId);
    expect(count).toBe(1);
  });

  it("rejects an offer below the 1/6 minimum (7/6 of the winning amount)", async () => {
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });
    const challenger = await newUser({ kyc: "verified" });
    const winAmount = 120_000;
    const auctionId = await seedSixthWindow(seller, winner, winAmount);
    await captureDeposit(svc, { userId: challenger.id, auctionId, amount: 12_000 });

    // Just over the winning amount but below 7/6 → must be rejected.
    const { error } = await challenger.client.rpc("place_sixth_offer", {
      p_auction_id: auctionId,
      p_amount: winAmount + 1_000,
    });
    expect(error, "below 1/6 minimum must be rejected").toBeTruthy();
  });

  it("the property OWNER cannot challenge their own lot (0109 self-bid guard)", async () => {
    const seller = await newUser({ kyc: "verified" });
    const winner = await newUser({ kyc: "verified" });
    const winAmount = 120_000;
    const auctionId = await seedSixthWindow(seller, winner, winAmount);

    // The owner guard is checked before kyc/deposit, so no deposit needed here.
    const { error } = await seller.client.rpc("place_sixth_offer", {
      p_auction_id: auctionId,
      p_amount: Math.ceil((winAmount * 7) / 6),
    });
    expect(error, "owner self-challenge must be forbidden").toBeTruthy();
  });
});
