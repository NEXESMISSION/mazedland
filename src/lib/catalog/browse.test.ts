import { describe, it, expect } from "vitest";
import { PRICE_BUCKETS, TYPE_TO_CATEGORY, catalogueHrefFor, catalogueHrefForType, findCategory } from "./browse";

describe("catalogueHrefForType", () => {
  it("maps every home tile to a category filter", () => {
    for (const type of ["apartment", "villa", "house", "land", "commercial", "office"]) {
      expect(TYPE_TO_CATEGORY[type]).toBeTruthy();
      expect(catalogueHrefForType(type)).toBe(`/annonces?cat=${TYPE_TO_CATEGORY[type]}`);
    }
  });

  it("falls back to the unfiltered catalogue for an unknown type", () => {
    expect(catalogueHrefForType("castle")).toBe("/annonces");
  });
});

describe("PRICE_BUCKETS", () => {
  it("covers every price with no gap and no overlap", () => {
    // A gap means properties in it appear in no bracket at all; an overlap
    // means two brackets claim the same property. The first bracket starts at
    // 0 and the last is open-ended.
    expect(PRICE_BUCKETS[0].min).toBeUndefined();
    expect(PRICE_BUCKETS[PRICE_BUCKETS.length - 1].max).toBeUndefined();
    for (let i = 1; i < PRICE_BUCKETS.length; i++) {
      expect(PRICE_BUCKETS[i].min).toBe((PRICE_BUCKETS[i - 1].max as number) + 1);
    }
  });

  it("matches the brackets the home page links into", () => {
    // Same boundaries in both places, so a bracket chosen on the home page is
    // the bracket highlighted in the catalogue.
    expect(PRICE_BUCKETS.map((b) => [b.min ?? null, b.max ?? null])).toEqual([
      [null, 99_999],
      [100_000, 499_999],
      [500_000, 999_999],
      [1_000_000, null],
    ]);
  });
});

describe("findCategory", () => {
  const LAND = { id: "6f1d6a2e-3b7c-4d2a-9a51-0c9b1f2e7a10", slug: "terrain" };
  const FLAT = { id: "9b3c1e47-5a2d-4f8e-b6c0-2d4e6f8a0b12", slug: "appartements" };
  const cats = [FLAT, LAND];

  it("reads the slug the catalogue's own chips send", () => {
    expect(findCategory("terrain", cats)).toBe(LAND);
  });

  it("reads an id too, so the old « Tout voir » links still filter", () => {
    expect(findCategory(LAND.id, cats)).toBe(LAND);
    expect(findCategory(LAND.id.toUpperCase(), cats)).toBe(LAND);
  });

  it("names nothing for an empty or unknown value", () => {
    expect(findCategory(undefined, cats)).toBeNull();
    expect(findCategory("  ", cats)).toBeNull();
    expect(findCategory("chateaux", cats)).toBeNull();
    expect(findCategory("00000000-0000-4000-8000-000000000000", cats)).toBeNull();
  });
});

describe("catalogueHrefFor", () => {
  it("carries the slug and the deal", () => {
    expect(catalogueHrefFor({ cat: "terrain", deal: "sale" })).toBe("/annonces?cat=terrain&deal=sale");
    expect(catalogueHrefFor({ cat: null, deal: "rent" })).toBe("/annonces?deal=rent");
    expect(catalogueHrefFor({})).toBe("/annonces");
  });
});
