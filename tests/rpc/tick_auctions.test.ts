// ============================================================================
// tick_auctions / tick_auctions_cron — the settlement engine (0078 + 0100).
//
// This is the function that DECIDES money outcomes: it picks the winner (top
// bid), enforces the reserve price, opens & finalizes the 8-day sixth-offer
// window, releases losing deposits (via the _release_deposits_on_close
// trigger), and auto-relists unsold lots. It had zero coverage; a regression in
// winner selection or reserve handling would silently ship. These tests pin the
// core transitions.
//
// tick_auctions processes EVERY due row globally, so each test asserts only on
// ITS OWN seeded auction id (other parallel rows are irrelevant to that assert).
// Bids are inserted directly via service-role (we are testing tick_auctions,
// not place_bid's gates).
// ============================================================================
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createUser,
  deleteUsers,
  getAuction,
  captureDeposit,
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

/** Insert a bid row directly (service-role; bypasses place_bid's gates). */
async function insertBid(auctionId: string, bidderId: string, amount: number) {
  const { error } = await svc
    .from("bids")
    .insert({ auction_id: auctionId, bidder_id: bidderId, amount, is_proxy: false });
  if (error) throw new Error(`insertBid failed: ${error.message}`);
}

const tick = async () => {
  const { error } = await svc.rpc("tick_auctions");
  if (error) throw new Error(`tick_auctions failed: ${error.message}`);
};

/** Did tick_auctions relist this lot? (a new scheduled auction points back at it) */
async function relistOf(auctionId: string): Promise<number> {
  const { data } = await svc
    .from("auctions")
    .select("id, status")
    .eq("relisted_from_id", auctionId);
  return (data ?? []).length;
}

describe("tick_auctions — settlement engine", () => {
  it("English lot with a valid high bid → sixth_offer_window, winner + price set", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id, type: "english", status: "live",
      openingPrice: 100_000, reservePrice: null, endsInSeconds: -10,
    });
    await insertBid(auctionId, bidder.id, 120_000);

    await tick();

    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("sixth_offer_window");
    expect(a.winner_user_id).toBe(bidder.id);
    expect(Number(a.winner_amount)).toBe(120_000);
    expect(Number(a.current_price)).toBe(120_000);
    expect(a.sixth_offer_deadline).not.toBeNull();
  });

  it("reserve NOT met → ended_unsold + a relist is created (no winner)", async () => {
    const seller = await newUser();
    const bidder = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id, type: "english", status: "live",
      openingPrice: 100_000, reservePrice: 200_000, endsInSeconds: -10,
    });
    await insertBid(auctionId, bidder.id, 120_000); // below reserve

    await tick();

    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("ended_unsold");
    expect(a.winner_user_id).toBeNull();
    expect(await relistOf(auctionId)).toBe(1);
  });

  it("no bids → ended_unsold + relist", async () => {
    const seller = await newUser();
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id, type: "english", status: "live",
      openingPrice: 100_000, endsInSeconds: -10,
    });

    await tick();

    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("ended_unsold");
    expect(await relistOf(auctionId)).toBe(1);
  });

  it("releases a losing bidder's deposit when the lot closes", async () => {
    const seller = await newUser();
    const loser = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id, type: "english", status: "live",
      openingPrice: 100_000, endsInSeconds: -10,
    });
    // An active (captured) deposit on a lot that will close with no winner.
    await captureDeposit(svc, { userId: loser.id, auctionId, amount: 10_000 });

    await tick();

    const { data: dep } = await svc
      .from("auction_deposits")
      .select("released_at, forfeited_at")
      .eq("auction_id", auctionId)
      .eq("user_id", loser.id)
      .single();
    // The _release_deposits_on_close trigger frees the non-winner deposit.
    expect(dep?.released_at).not.toBeNull();
  });

  it("sixth-offer window past its deadline with no higher offer → awarded + payment-due stamped", async () => {
    const seller = await newUser();
    const winner = await newUser({ kyc: "verified" });
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id, type: "english", status: "sixth_offer_window",
      openingPrice: 100_000, currentPrice: 150_000,
      winnerUserId: winner.id, winnerAmount: 150_000, endsInSeconds: -86_400,
    });
    // Deadline already elapsed; no sixth_offers exist.
    await setAuction(svc, auctionId, {
      sixth_offer_deadline: new Date(Date.now() - 60_000).toISOString(),
      hammer_at: new Date(Date.now() - 86_400_000).toISOString(),
    });

    await tick();

    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("awarded");
    expect(a.winner_user_id).toBe(winner.id);
    expect(a.final_payment_due_at).not.toBeNull();
  });

  it("0100: a stranded 'scheduled' lot whose window elapsed is rescued + closed by tick_auctions_cron", async () => {
    const seller = await newUser();
    const { auctionId } = await seedAuction(svc, {
      ownerId: seller.id, type: "english", status: "scheduled",
      openingPrice: 100_000, startsInSeconds: -7200, endsInSeconds: -10,
    });

    // The cron wrapper flips fully-elapsed scheduled rows to 'live' then runs
    // tick_auctions, which closes them (no bids → ended_unsold).
    const { error } = await svc.rpc("tick_auctions_cron");
    expect(error, error?.message).toBeNull();

    const a = await getAuction(svc, auctionId);
    expect(a.status).toBe("ended_unsold");
  });
});
