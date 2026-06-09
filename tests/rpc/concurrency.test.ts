// ============================================================================
// place_bid concurrency — the FOR UPDATE row lock must serialize racing bids so
// there is no lost update. The benchmark flagged that the highest-traffic money
// path had zero concurrent-execution coverage. This fires N simultaneous bids
// and asserts exactly the invariant the lock guarantees.
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

describe("place_bid concurrency — FOR UPDATE serializes (no lost update)", () => {
  it("N distinct bidders racing the SAME opening bid → exactly ONE wins", async () => {
    const seller = await newUser();
    const N = 5;
    const opening = 100_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: opening,
    });

    const bidders: TestUser[] = [];
    for (let i = 0; i < N; i++) {
      const b = await newUser({ kyc: "verified" });
      await captureDeposit(svc, { userId: b.id, auctionId, amount: 10_000 });
      bidders.push(b);
    }

    // All N fire the SAME opening bid simultaneously. Whoever takes the row lock
    // first sets current_price=opening; every other then re-reads a non-null
    // current_price and must clear opening+increment, so they fail. Exactly one
    // can succeed — proof the FOR UPDATE lock serialized and nothing lost-updated
    // off the stale null price.
    const results = await Promise.all(
      bidders.map((b) =>
        b.client.rpc("place_bid", {
          p_auction_id: auctionId,
          p_amount: opening,
          p_max_amount: null,
          p_ip: null,
        }),
      ),
    );

    const succeeded = results.filter((r) => !r.error).length;
    expect(succeeded).toBe(1);

    const a = await getAuction(svc, auctionId);
    expect(Number(a.current_price)).toBe(opening);
    // The 0098 bid_count trigger must also be exactly right under concurrency.
    expect(a.bid_count).toBe(1);

    const { count } = await svc
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq("auction_id", auctionId);
    expect(count).toBe(1);
  });

  it("two concurrent requests can't reserve more payout than the balance", async () => {
    // Mirror of the request_payout race at the bid layer's sibling money path:
    // seed earnings, fire two payouts that each fit alone but not together,
    // assert at most the available balance is ever reserved.
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });
    const price = 100_000;
    const deposit = 10_000;
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id,
      type: "english",
      status: "live",
      openingPrice: price,
    });
    await captureDeposit(svc, { userId: winner.id, auctionId, amount: deposit });
    await svc.from("auctions").update({
      status: "ended_sold",
      winner_user_id: winner.id,
      winner_amount: price,
      current_price: price,
    }).eq("id", auctionId);
    await svc.from("payments").insert({
      user_id: winner.id, kind: "final_payment", provider: "manual",
      amount: price - deposit, status: "captured", auction_id: auctionId,
    });

    const { data: bal } = await seller.client.rpc("seller_balance", { p_seller_id: seller.id });
    const available = Number((bal as { available: number }).available);
    expect(available).toBeGreaterThan(0);

    // Two concurrent requests, each for the full available balance.
    const [r1, r2] = await Promise.all([
      seller.client.rpc("request_payout", { p_amount: available, p_iban: null }),
      seller.client.rpc("request_payout", { p_amount: available, p_iban: null }),
    ]);
    // Exactly one succeeds; the other hits insufficient_balance under the lock.
    const ok = [r1, r2].filter((r) => !r.error).length;
    expect(ok).toBe(1);
  });
});
