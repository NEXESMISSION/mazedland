import { describe, it, expect } from "vitest";
import { median, priceInWords, suggestPriceFix } from "./priceCheck";

describe("priceInWords", () => {
  it("reads a price back the way it is said, in French", () => {
    expect(priceInWords(300_000, "fr")).toBe("300 mille dinars");
    expect(priceInWords(1_200_000, "fr")).toBe("1,2 million de dinars");
    expect(priceInWords(3_000_000, "fr")).toBe("3 millions de dinars");
    expect(priceInWords(850, "fr")).toBe("850 dinars");
  });

  it("and in Arabic, with the Tunisian « مليون » and « مليار »", () => {
    expect(priceInWords(300_000, "ar")).toBe("300 ألف دينار — 300 مليون");
    expect(priceInWords(1_200_000, "ar")).toBe("1 200 ألف دينار — 1,2 مليار");
    expect(priceInWords(850, "ar")).toBe("850 دينار");
    expect(priceInWords(0, "ar")).toBeNull();
  });
});

describe("median", () => {
  it("needs three values", () => {
    expect(median([1, 2])).toBeNull();
    expect(median([300, 100, 200])).toBe(200);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("suggestPriceFix", () => {
  const ref = { median: 250_000, perSqm: 2_000 };

  it("offers ÷10 for a zero too many, against the usual price per m²", () => {
    expect(suggestPriceFix({ price: 2_400_000, areaSqm: 120, ref, kind: "residential", dealType: "sale" })).toBe(240_000);
  });

  it("offers ×10 for a zero too few", () => {
    expect(suggestPriceFix({ price: 24_000, areaSqm: 120, ref, kind: "residential", dealType: "sale" })).toBe(240_000);
  });

  it("says nothing about a price in the usual range, or one no ×10 fixes", () => {
    expect(suggestPriceFix({ price: 300_000, areaSqm: 120, ref, kind: "residential", dealType: "sale" })).toBeNull();
    expect(suggestPriceFix({ price: 120_000_000, areaSqm: 120, ref, kind: "residential", dealType: "sale" })).toBeNull();
  });

  it("falls back on the usual range for Tunisia when there is nothing to compare with", () => {
    // 2 600 000 DT for 110 m² is 23 600 DT/m²: one zero too many.
    expect(suggestPriceFix({ price: 2_600_000, areaSqm: 110, ref: null, kind: "residential", dealType: "sale" })).toBe(260_000);
    // A rent of 45 000 a month for 100 m²: 4 500 is the usual.
    expect(suggestPriceFix({ price: 45_000, areaSqm: 100, ref: null, kind: "residential", dealType: "rent" })).toBe(4_500);
    // 26 000 DT for a 110 m² flat: one zero too few.
    expect(suggestPriceFix({ price: 26_000, areaSqm: 110, ref: null, kind: "residential", dealType: "sale" })).toBe(260_000);
    // Land without a surface: the whole price is in range, nothing to say.
    expect(suggestPriceFix({ price: 90_000, areaSqm: null, ref: null, kind: "land", dealType: "sale" })).toBeNull();
  });
});
