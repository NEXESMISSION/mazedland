import { describe, it, expect } from "vitest";
import type { Auction } from "./types";
import {
  nextMinBid,
  nextEndsAtAfterBid,
  dutchCurrentPrice,
  minSixthOffer,
  secondsRemaining,
} from "./auction-engine";

// Minimal Auction fixture — only the fields the engine reads. Cast keeps the
// tests focused on behavior without dragging the full DB row shape in.
function auction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    type: "english",
    status: "live",
    opening_price: 100_000,
    current_price: null,
    starts_at: "2026-06-01T00:00:00Z",
    ends_at: "2026-06-10T00:00:00Z",
    extend_window_seconds: 300,
    extend_by_seconds: 600,
    ...overrides,
  } as unknown as Auction;
}

describe("nextMinBid", () => {
  it("returns the opening price when there are no bids", () => {
    expect(nextMinBid(auction({ current_price: null }))).toBe(100_000);
    expect(nextMinBid(auction({ current_price: null }), 0)).toBe(100_000);
  });
  it("adds one increment over the current price (ladder §8)", () => {
    // 100k → +5k band
    expect(nextMinBid(auction({ current_price: 100_000 }))).toBe(105_000);
    // explicit currentBid arg wins over the row
    expect(nextMinBid(auction({ current_price: 100_000 }), 600_000)).toBe(610_000);
  });
});

describe("nextEndsAtAfterBid (anti-snipe)", () => {
  const a = auction({ ends_at: "2026-06-10T12:00:00Z", extend_window_seconds: 300, extend_by_seconds: 600 });
  it("does NOT extend when the bid is before the trigger window", () => {
    expect(nextEndsAtAfterBid(a, new Date("2026-06-10T11:50:00Z"))).toBeNull();
  });
  it("extends by extend_by_seconds when the bid lands inside the window", () => {
    const out = nextEndsAtAfterBid(a, new Date("2026-06-10T11:58:00Z"));
    expect(out?.toISOString()).toBe("2026-06-10T12:10:00.000Z");
  });
});

describe("dutchCurrentPrice", () => {
  const d = auction({
    type: "dutch",
    starts_at: "2026-06-01T00:00:00Z",
    dutch_start_price: 200_000,
    dutch_floor_price: 150_000,
    dutch_decrement: 10_000,
    dutch_tick_seconds: 60,
  } as Partial<Auction>);
  it("returns the start price at t=0", () => {
    expect(dutchCurrentPrice(d, new Date("2026-06-01T00:00:00Z"))).toBe(200_000);
  });
  it("drops one decrement per tick", () => {
    // 2.5 ticks → floor(2.5)=2 decrements → 200k - 20k
    expect(dutchCurrentPrice(d, new Date("2026-06-01T00:02:30Z"))).toBe(180_000);
  });
  it("never falls below the floor", () => {
    expect(dutchCurrentPrice(d, new Date("2026-06-02T00:00:00Z"))).toBe(150_000);
  });
  it("throws on a non-dutch auction", () => {
    expect(() => dutchCurrentPrice(auction({ type: "english" }))).toThrow();
  });
});

describe("minSixthOffer (Tunisian 1/6 rule)", () => {
  it("requires at least +1/6 over the winning amount, rounded up", () => {
    expect(minSixthOffer(120_000)).toBe(140_000); // 120k * 7/6
    expect(minSixthOffer(100_000)).toBe(116_667); // ceil(116666.67)
  });
});

describe("secondsRemaining", () => {
  it("is positive before end, negative after", () => {
    const now = new Date("2026-06-10T11:59:00Z");
    expect(secondsRemaining("2026-06-10T12:00:00Z", now)).toBe(60);
    expect(secondsRemaining("2026-06-10T11:58:00Z", now)).toBe(-60);
  });
});
