import { describe, it, expect } from "vitest";
import { TYPE_TO_CATEGORY, catalogueHrefForType } from "./browse";

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
