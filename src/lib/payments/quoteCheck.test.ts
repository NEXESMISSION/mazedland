import { describe, it, expect } from "vitest";
import { amountMatches, expectedAmount, PRODUCT_KIND_OF, PRODUCT_REQUIRED } from "./quoteCheck";

// The console grants what the server quoted, never what the row says: in the
// QA tour a self-written row of 1 TND bought a Business plan.
describe("expectedAmount()", () => {
  it("a placement, a badge, a pack: the product's price", () => {
    expect(expectedAmount("promo", { list_price: 1 }, 15)).toBe(15);
    expect(expectedAmount("badge", null, 49.9)).toBe(49.9);
    expect(expectedAmount("listing_pack", undefined, 50)).toBe(50);
  });

  it("a plan: the list price frozen when it was quoted, less an upgrade's credit", () => {
    expect(expectedAmount("subscription", { list_price: 119, change: "upgrade", credit: 28 }, 129)).toBe(91);
    expect(expectedAmount("subscription", { list_price: 59, change: "new" }, 129)).toBe(59);
    // A credit only counts for an upgrade; a stray one on a renewal is ignored.
    expect(expectedAmount("subscription", { list_price: 59, change: "renew", credit: 28 }, 59)).toBe(59);
  });

  it("a plan quoted before 2026-10-28 (no list price): the product's price", () => {
    expect(expectedAmount("subscription", {}, 59)).toBe(59);
    expect(expectedAmount("subscription", { list_price: "abc" }, 59)).toBe(59);
  });

  it("never asks for less than nothing", () => {
    expect(expectedAmount("subscription", { list_price: 59, change: "upgrade", credit: 80 }, 59)).toBe(0);
    expect(expectedAmount("subscription", { list_price: 59, change: "upgrade", credit: -5 }, 59)).toBe(59);
  });
});

describe("amountMatches()", () => {
  it("to the centime", () => {
    expect(amountMatches(59, 59)).toBe(true);
    expect(amountMatches(59.004, 59)).toBe(true);
    expect(amountMatches(58.99, 59)).toBe(false);
    expect(amountMatches(1, 119)).toBe(false);
    expect(amountMatches(Number.NaN, 59)).toBe(false);
  });
});

describe("the product a payment kind buys", () => {
  it("is named for every kind the console settles", () => {
    expect(PRODUCT_KIND_OF.promo).toBe("promo");
    expect(PRODUCT_KIND_OF.badge).toBe("badge_verified");
    expect(PRODUCT_KIND_OF.listing_fee).toBe("listing_single");
    for (const k of PRODUCT_REQUIRED) expect(PRODUCT_KIND_OF[k]).toBeDefined();
  });
});
