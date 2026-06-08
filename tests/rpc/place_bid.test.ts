// ============================================================================
// place_bid — the bid-acceptance gate (migrations 0006 → 0046 → 0077 → 0091).
//
// place_bid is SECURITY DEFINER and runs as the BIDDER's signed-in client
// (it reads auth.uid()). Each gate is asserted by the exception message it
// raises (surfaced by supabase-js as error.message):
//   * below_min_increment   — under current_price + bid_increment()
//   * self_bid_forbidden    — the property owner cannot bid on their own lot
//   * deposit_required      — no active (unreleased/unforfeited) deposit
//   * bid_too_fast          — second bid inside the 2s per-bidder cooldown
//   * auction_closed        — auction not in ('live','extending')
// Positive paths:
//   * a valid opening/raise bid is accepted (ok:true)
//   * the current top bidder may self-raise at current_price + 1
//   * a bid inside extend_window_seconds pushes ends_at out (anti-snipe)
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

async function bid(
  user: TestUser,
  auctionId: string,
  amount: number,
  maxAmount: number | null = null,
) {
  return user.client.rpc("place_bid", {
    p_auction_id: auctionId,
    p_amount: amount,
    p_max_amount: maxAmount,
    p_ip: null,
  });
}

describe("place_bid — gates", () => {
  it("rejects below_min_increment", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
      currentPrice: opening, // increment at 100k is 5000 → min next is 105000
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    const { error } = await bid(bidder, auctionId, opening + 100); // way under +5000
    expect(error?.message).toContain("below_min_increment");
  });

  it("rejects self_bid_forbidden (owner bidding on own lot)", async () => {
    const seller = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: 100_000,
    });
    // Give the owner a deposit so we get PAST deposit_required to the self-bid gate.
    await captureDeposit(svc, { userId: seller.id, auctionId, amount: 10_000 });

    const { error } = await bid(seller, auctionId, 100_000);
    expect(error?.message).toContain("self_bid_forbidden");
  });

  it("rejects deposit_required (no active deposit)", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: 100_000,
    });
    // No deposit captured for the bidder.
    const { error } = await bid(bidder, auctionId, 100_000);
    expect(error?.message).toContain("deposit_required");
  });

  it("rejects bid_too_fast (second bid inside the 2s cooldown)", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    // First bid: opening (no current_price yet) — accepted.
    const first = await bid(bidder, auctionId, opening);
    expect(first.error?.message).toBeUndefined();

    // Immediate self-raise within 2s → bid_too_fast (cooldown is per-bidder).
    const second = await bid(bidder, auctionId, opening + 1);
    expect(second.error?.message).toContain("bid_too_fast");
  });

  it("rejects auction_closed (status not live/extending)", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "ended_unsold",
      openingPrice: 100_000,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    const { error } = await bid(bidder, auctionId, 100_000);
    expect(error?.message).toContain("auction_closed");
  });
});

describe("place_bid — accepted paths", () => {
  it("accepts a valid opening bid", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    const { data, error } = await bid(bidder, auctionId, opening);
    expect(error?.message).toBeUndefined();
    expect((data as { ok: boolean }).ok).toBe(true);

    const a = await getAuction(svc, auctionId);
    expect(Number(a.current_price)).toBeCloseTo(opening, 2);
  });

  it("accepts the top bidder self-raising to current_price + 1", async () => {
    const seller = await newUser();
    const top = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
    });
    await captureDeposit(svc, { userId: top.id, auctionId, amount: 10_000 });

    // Establish the top bid.
    const first = await bid(top, auctionId, opening);
    expect(first.error?.message).toBeUndefined();

    // Wait out the 2s per-bidder cooldown, then self-raise by just +1 (the
    // self-raise branch only requires p_amount > current_price, no increment).
    await new Promise((r) => setTimeout(r, 2100));
    const raise = await bid(top, auctionId, opening + 1);
    expect(raise.error?.message).toBeUndefined();
    expect((raise.data as { ok: boolean }).ok).toBe(true);

    const a = await getAuction(svc, auctionId);
    expect(Number(a.current_price)).toBeCloseTo(opening + 1, 2);
  });

  it("extends ends_at when a bid lands inside the anti-snipe window", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const opening = 100_000;
    const extendWindow = 300; // 5 min
    const extendBy = 600; // 10 min
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
      // Ends in 60s → inside the 300s extend window → bid should push it out.
      endsInSeconds: 60,
      extendWindowSeconds: extendWindow,
      extendBySeconds: extendBy,
    });
    await captureDeposit(svc, { userId: bidder.id, auctionId, amount: 10_000 });

    const before = await getAuction(svc, auctionId);
    const { data, error } = await bid(bidder, auctionId, opening);
    expect(error?.message).toBeUndefined();
    expect((data as { extended: boolean }).extended).toBe(true);

    const after = await getAuction(svc, auctionId);
    const delta =
      new Date(after.ends_at).getTime() - new Date(before.ends_at).getTime();
    // Pushed by ~extend_by_seconds (allow a few seconds of clock slack).
    expect(delta).toBeGreaterThanOrEqual((extendBy - 5) * 1000);
    expect(after.status).toBe("extending");
  });
});
