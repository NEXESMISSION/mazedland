// ============================================================================
// request_payout — the seller withdrawal guard (migrations 0020 → 0069).
//
// 0069 added pg_advisory_xact_lock(hashtext('payout:'||seller)) BEFORE the
// balance read so two concurrent requests can't both reserve the same
// available funds (the over-reservation race). These tests assert:
//   * two CONCURRENT requests that each fit individually but TOGETHER exceed
//     available end with at most `available` reserved (one wins, one is
//     rejected with insufficient_balance);
//   * `available` (seller_balance) never goes negative even after a payout
//     reserves the whole balance.
//
// Available balance is created by capturing a buy_now for a winner on the
// seller's auction, which credits seller_earnings.net (gross * 0.95).
// request_payout reads auth.uid() → called as the seller's signed-in client.
// ============================================================================
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  capturePurchase,
  createUser,
  deleteUsers,
  requireEnv,
  seedAuction,
  type TestUser,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const COMMISSION = 0.05;
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

async function balance(seller: TestUser) {
  const { data, error } = await seller.client.rpc("seller_balance", {
    p_seller_id: seller.id,
  });
  if (error) throw new Error(`seller_balance failed: ${error.message}`);
  return data as {
    lifetime_net: number;
    available: number;
    pending_payout: number;
  };
}

async function payout(seller: TestUser, amount: number) {
  return seller.client.rpc("request_payout", { p_amount: amount, p_iban: "TN59..." });
}

/** Seed a sold auction so the seller has `net(price)` available to withdraw. */
async function seedSale(seller: TestUser, price: number): Promise<void> {
  const winner = await newUser({ kyc: "verified" });
  const { auctionId } = await seedAuction(svc, {
    ownerId: seller.id,
    type: "english",
    status: "live",
    openingPrice: Math.floor(price / 2),
    buyNowPrice: price,
  });
  const res = await capturePurchase(svc, {
    userId: winner.id,
    auctionId,
    amount: price,
    kind: "buy_now",
  });
  if (res.error) throw new Error(`seedSale capturePurchase failed: ${res.error}`);
}

describe("request_payout — advisory lock prevents over-reservation", () => {
  it("two concurrent requests cannot reserve more than available", async () => {
    const seller = await newUser();
    const price = 100_000;
    await seedSale(seller, price);

    const avail = net(price); // 95_000
    const b0 = await balance(seller);
    expect(b0.available).toBeCloseTo(avail, 2);

    // Each request is for 60% of available — individually fine, but the two
    // together (120%) cannot both be honoured. Fire them concurrently so they
    // contend on the per-seller advisory lock.
    const amount = Math.round(avail * 0.6);
    const [r1, r2] = await Promise.all([payout(seller, amount), payout(seller, amount)]);

    const oks = [r1, r2].filter((r) => !r.error).length;
    const rejected = [r1, r2].filter(
      (r) => r.error && /insufficient_balance/.test(r.error.message),
    ).length;

    // Exactly one succeeds; the other is rejected for insufficient balance.
    expect(oks).toBe(1);
    expect(rejected).toBe(1);

    // Ledger truth: total reserved (pending) never exceeds available, and
    // available is now non-negative.
    const b1 = await balance(seller);
    expect(b1.pending_payout).toBeLessThanOrEqual(avail + 0.01);
    expect(b1.pending_payout).toBeCloseTo(amount, 2); // only ONE reservation landed
    expect(b1.available).toBeGreaterThanOrEqual(0);
  });

  it("available never goes negative after reserving the whole balance", async () => {
    const seller = await newUser();
    const price = 80_000;
    await seedSale(seller, price);

    const avail = net(price);
    const first = await payout(seller, avail);
    expect(first.error?.message).toBeUndefined();

    // Balance is now fully reserved.
    const b1 = await balance(seller);
    expect(b1.available).toBeCloseTo(0, 2);
    expect(b1.available).toBeGreaterThanOrEqual(0);

    // A further request for any positive amount must be rejected (not go negative).
    const second = await payout(seller, 1_000);
    expect(second.error?.message).toContain("insufficient_balance");

    const b2 = await balance(seller);
    expect(b2.available).toBeGreaterThanOrEqual(0);
  });
});
