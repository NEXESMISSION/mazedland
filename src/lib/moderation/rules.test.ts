import { describe, it, expect } from "vitest";
import {
  checkListing,
  containsBannedWord,
  hasContactInText,
  isPriceImplausible,
  latinDigits,
  sameTitle,
  MIN_PHOTOS,
  type ListingFacts,
  type ListingRules,
} from "./rules";
import { SETTINGS } from "@/lib/settings/registry";

const clean: ListingFacts = {
  title: "Villa avec jardin · Sakiet Ezzit",
  description: "Villa de 4 pièces, jardin de 300 m², proche des écoles.",
  price: 650_000,
  priceOnRequest: false,
  areaSqm: 250,
  kind: "residential",
  dealType: "sale",
  photoCount: 5,
  duplicate: false,
};

const RULES: ListingRules = { minPhotos: MIN_PHOTOS, bannedWords: ["casino"] };

describe("checkListing", () => {
  it("passes a clean annonce", () => {
    expect(checkListing(clean, RULES)).toEqual([]);
  });

  it("names every rule an annonce fails", () => {
    expect(
      checkListing(
        { ...clean, photoCount: 1, description: "Appelez le 98 124 111", price: 500, duplicate: true },
        { ...RULES, bannedWords: [] },
      ),
    ).toEqual(["too_few_photos", "contact_in_text", "price_implausible", "duplicate"]);
  });

  it("counts photos against the minimum an admin set", () => {
    expect(checkListing({ ...clean, photoCount: 5 }, { ...RULES, minPhotos: 6 })).toEqual(["too_few_photos"]);
    expect(checkListing({ ...clean, photoCount: 0 }, { ...RULES, minPhotos: 0 })).toEqual([]);
  });

  it("keeps MIN_PHOTOS equal to the setting's default", () => {
    // Code without the settings at hand falls back on the constant: no drift.
    expect(MIN_PHOTOS).toBe(SETTINGS.moderation_min_photos.default);
  });
});

describe("hasContactInText", () => {
  it("catches Tunisian numbers however they are written", () => {
    for (const t of ["98124111", "98 124 111", "98.124.111", "+216 98 124 111", "00216 98124111", "٩٨١٢٤١١١"]) {
      expect(hasContactInText(`Contact : ${t}`)).toBe(true);
    }
  });

  it("catches e-mails, links and messengers", () => {
    expect(hasContactInText("écrivez à vendeur@gmail.com")).toBe(true);
    expect(hasContactInText("voir www.exemple.tn")).toBe(true);
    expect(hasContactInText("dispo sur WhatsApp")).toBe(true);
    expect(hasContactInText("كلمني على الواتساب")).toBe(true);
  });

  it("leaves surfaces, prices and years alone", () => {
    expect(hasContactInText("Terrain de 13 000 m², construit en 2019, 4 pièces, prix 350000")).toBe(false);
    expect(hasContactInText("أرض 4942م² · طريق المطار كلم 10")).toBe(false);
  });
});

describe("containsBannedWord", () => {
  it("matches whole Latin words, ignoring case and accents", () => {
    expect(containsBannedWord("Investissez en CRYPTO", ["crypto"])).toBe(true);
    expect(containsBannedWord("Cryptographie moderne", ["crypto"])).toBe(false);
  });

  it("matches Arabic inside a word", () => {
    expect(containsBannedWord("والكازينو قريب", ["كازينو"])).toBe(true);
  });
});

describe("isPriceImplausible", () => {
  it("flags typos and bait", () => {
    expect(isPriceImplausible({ price: 15, priceOnRequest: false, areaSqm: 100, kind: "residential" })).toBe(true);
    expect(isPriceImplausible({ price: 20_000, priceOnRequest: false, areaSqm: 300, kind: "residential" })).toBe(true);
  });

  it("accepts real Tunisian prices, cheap farmland included", () => {
    expect(isPriceImplausible({ price: 850_000, priceOnRequest: false, areaSqm: 190_000, kind: "land" })).toBe(false);
    expect(isPriceImplausible({ price: 280_000, priceOnRequest: false, areaSqm: 120, kind: "residential" })).toBe(false);
  });

  it("does not judge a price on request or a missing area", () => {
    expect(isPriceImplausible({ price: null, priceOnRequest: true, areaSqm: null, kind: "land" })).toBe(false);
    expect(isPriceImplausible({ price: 90_000, priceOnRequest: false, areaSqm: null, kind: "land" })).toBe(false);
  });

  it("reads a rent as a monthly figure", () => {
    const flat = { priceOnRequest: false, areaSqm: 110, kind: "residential" as const };
    // 1 200 TND a month for an S+2 is a rent; the same 1 200 as a sale price is a typo.
    expect(isPriceImplausible({ ...flat, price: 1_200, dealType: "rent" })).toBe(false);
    expect(isPriceImplausible({ ...flat, price: 1_200, dealType: "sale" })).toBe(true);
    // A sale price typed into a rental is caught too.
    expect(isPriceImplausible({ ...flat, price: 350_000, dealType: "rent" })).toBe(true);
    expect(isPriceImplausible({ ...flat, price: 20, dealType: "rent" })).toBe(true);
    // Farmland rents by the hectare-year: only the absolute bounds apply.
    expect(
      isPriceImplausible({ price: 300, priceOnRequest: false, areaSqm: 50_000, kind: "land", dealType: "rent" }),
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("turns Arabic-Indic digits Latin", () => {
    expect(latinDigits("٢٠٢٦ و ۱۲")).toBe("2026 و 12");
  });

  it("treats titles that differ only in case, accents or spacing as the same", () => {
    expect(sameTitle("Villa à Sfax — 4 pièces", "villa a sfax 4 pieces")).toBe(true);
    expect(sameTitle("Villa à Sfax", "Villa à Sousse")).toBe(false);
  });
});
