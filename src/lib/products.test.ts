import { describe, it, expect } from "vitest";
import {
  badgeProduct,
  pricePerListing,
  purchasablePacks,
  isFree,
  resolveListingFee,
  toProduct,
  usableCredits,
  type Product,
  type SellerCredit,
} from "./products";

/**
 * Pricing is the commercial core of v3, and every number here ends up on an
 * invoice. These lock the two rules that are easy to get quietly wrong: a
 * category price must beat the global one, and "no price configured" must never
 * be mistaken for "free".
 */

const base: Product = {
  id: "p-global",
  slug: "annonce-standard",
  kind: "listing_single",
  nameFr: "Annonce standard",
  nameAr: null,
  description: null,
  price: 15,
  categoryId: null,
  listingQuota: null,
  durationDays: 30,
  isActive: true,
  sortOrder: 10,
};

const make = (over: Partial<Product>): Product => ({ ...base, ...over });

describe("resolveListingFee", () => {
  it("uses the global price when the category has none", () => {
    expect(resolveListingFee([base], "cat-voitures")?.price).toBe(15);
  });

  it("a category price beats the global one (D4)", () => {
    // The whole point: a 200 TND brake pad cannot carry a car's fee.
    const parts = make({ id: "p-parts", slug: "annonce-piece", price: 3, categoryId: "cat-freinage" });
    expect(resolveListingFee([base, parts], "cat-freinage")?.price).toBe(3);
    expect(resolveListingFee([base, parts], "cat-voitures")?.price).toBe(15);
  });

  it("ignores inactive prices", () => {
    const off = make({ id: "p-off", categoryId: "cat-freinage", price: 3, isActive: false });
    expect(resolveListingFee([base, off], "cat-freinage")?.price).toBe(15);
  });

  it("returns null when nothing is priced — NOT free", () => {
    // The caller must treat this as "cannot publish". Publishing at 0 because
    // no row existed would be a silent revenue hole.
    expect(resolveListingFee([], "cat-voitures")).toBeNull();
    expect(resolveListingFee([make({ isActive: false })], "cat-voitures")).toBeNull();
  });

  it("does not mistake another kind for a listing price", () => {
    const badge = make({ id: "p-badge", kind: "badge_verified", price: 200, durationDays: 365 });
    expect(resolveListingFee([badge], "cat-voitures")).toBeNull();
  });

  // ── Parent inheritance: how spare parts are free (0167) ──────────────────
  const partsParent = make({
    id: "p-parts-parent",
    slug: "annonce-piece",
    price: 0,
    categoryId: "cat-pieces",
  });

  it("inherits a parent category's price", () => {
    // "Les pièces sont gratuites" is ONE row on « Pièces de rechange », not
    // nine identical rows on its children that would drift apart.
    expect(resolveListingFee([base, partsParent], "cat-freinage", "cat-pieces")?.price).toBe(0);
    expect(resolveListingFee([base, partsParent], "cat-moteur", "cat-pieces")?.price).toBe(0);
  });

  it("covers a sub-category nobody has priced yet", () => {
    // A category added next month must inherit free, not fall through to the
    // 15 TND catch-all — which is the failure this lookup exists to prevent.
    expect(resolveListingFee([base, partsParent], "cat-brand-new", "cat-pieces")?.price).toBe(0);
  });

  it("still lets a child override its parent", () => {
    const pricey = make({ id: "p-tyres", price: 5, categoryId: "cat-pneus" });
    expect(resolveListingFee([base, partsParent, pricey], "cat-pneus", "cat-pieces")?.price).toBe(5);
  });

  it("leaves cars alone", () => {
    expect(resolveListingFee([base, partsParent], "cat-voitures", "cat-vehicules")?.price).toBe(15);
  });
});

describe("isFree", () => {
  it("separates a deliberate zero from an unpriced category", () => {
    // The distinction the submit route turns on: zero skips payment entirely,
    // null refuses to publish. Collapsing them would either charge for a free
    // part or give away a car.
    expect(isFree(make({ price: 0 }))).toBe(true);
    expect(isFree(make({ price: 15 }))).toBe(false);
    expect(isFree(null)).toBe(false);
  });
});

describe("packs", () => {
  const pack5 = make({ id: "p5", slug: "pack-5", kind: "listing_pack", price: 120, listingQuota: 5 });
  const pack20 = make({ id: "p20", slug: "pack-20", kind: "listing_pack", price: 400, listingQuota: 20 });

  it("offers only active packs and subscriptions, cheapest first", () => {
    const sub = make({ id: "sub", kind: "subscription", price: 60, listingQuota: 10 });
    const list = purchasablePacks([pack20, base, pack5, sub, make({ id: "off", kind: "listing_pack", price: 1, listingQuota: 2, isActive: false })]);
    expect(list.map((p) => p.id)).toEqual(["sub", "p5", "p20"]);
  });

  it("computes the per-publication price a seller would work out by hand", () => {
    expect(pricePerListing(pack5)).toBe(24);
    expect(pricePerListing(pack20)).toBe(20);
  });

  it("has no per-publication price without a quota", () => {
    expect(pricePerListing(base)).toBeNull();
  });
});

describe("badgeProduct", () => {
  it("finds the badge only while it is on sale", () => {
    const badge = make({ id: "b", kind: "badge_verified", price: 200, durationDays: 365 });
    expect(badgeProduct([base, badge])?.id).toBe("b");
    expect(badgeProduct([base, { ...badge, isActive: false }])).toBeNull();
  });
});

describe("usableCredits", () => {
  const now = new Date("2026-09-02T00:00:00Z");
  const credit = (over: Partial<SellerCredit>): SellerCredit => ({
    id: "c1",
    productName: "Pack 5",
    quotaTotal: 5,
    quotaUsed: 2,
    remaining: 3,
    expiresAt: "2027-01-01T00:00:00Z",
    status: "active",
    ...over,
  });

  it("counts what is left across active packs", () => {
    expect(usableCredits([credit({}), credit({ id: "c2", remaining: 1 })], now)).toBe(4);
  });

  it("ignores expired packs even when the status still says active (D9)", () => {
    // The nightly job flips the status, so between expiry and the job there is
    // a window where the date is the only truth.
    expect(usableCredits([credit({ expiresAt: "2026-08-01T00:00:00Z" })], now)).toBe(0);
  });

  it("ignores exhausted and revoked packs", () => {
    expect(usableCredits([credit({ status: "exhausted", remaining: 0 })], now)).toBe(0);
    expect(usableCredits([credit({ status: "revoked" })], now)).toBe(0);
  });
});

describe("toProduct", () => {
  it("reads a row and defaults an unknown kind rather than throwing", () => {
    const p = toProduct({
      id: "x", slug: "s", kind: "not_a_kind", name_fr: "X", name_ar: null,
      description: null, price: "12.50", category_id: null, listing_quota: null,
      duration_days: 30, is_active: true, sort_order: 1,
    });
    expect(p.kind).toBe("listing_single");
    expect(p.price).toBe(12.5);
  });
});
