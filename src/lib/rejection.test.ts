import { describe, it, expect } from "vitest";
import {
  parseRejection,
  encodeRejection,
  REJECTION_CATEGORIES,
  type RejectionCategory,
} from "./rejection";

describe("parseRejection", () => {
  it("treats untagged legacy text as a full-mode general rejection", () => {
    const r = parseRejection("Photos floues, merci de refaire.");
    expect(r.tagged).toBe(false);
    expect(r.category).toBe("general");
    expect(r.mode).toBe("full");
    expect(r.message).toBe("Photos floues, merci de refaire.");
  });

  it("parses a single category prefix (focused by default)", () => {
    const r = parseRejection("[PHOTOS] Reprenez les photos.");
    expect(r.tagged).toBe(true);
    expect(r.categories).toEqual(["photos"]);
    expect(r.mode).toBe("focused");
    expect(r.message).toBe("Reprenez les photos.");
  });

  it("parses multiple categories and the ALL mode", () => {
    const r = parseRejection("[PHOTOS,DOCUMENTS|ALL] Plusieurs soucis.");
    expect(r.categories).toEqual(["photos", "documents"]);
    expect(r.mode).toBe("full");
    expect(r.label).toBe("Photos · Documents");
  });

  it("dedupes repeated categories preserving order", () => {
    const r = parseRejection("[PHOTOS,PHOTOS,PRICE] x");
    expect(r.categories).toEqual(["photos", "price"]);
  });

  it("falls back to general when the prefix has no known category", () => {
    const r = parseRejection("[BOGUS] message");
    expect(r.tagged).toBe(false);
    expect(r.category).toBe("general");
  });

  it("handles empty / nullish input", () => {
    expect(parseRejection("").message).toBe("");
    expect(parseRejection(null).category).toBe("general");
  });
});

describe("encodeRejection <-> parseRejection round-trip", () => {
  it("round-trips a focused single-category rejection", () => {
    const encoded = encodeRejection("price", "Prix trop élevé");
    const parsed = parseRejection(encoded);
    expect(parsed.categories).toEqual(["price"]);
    expect(parsed.mode).toBe("focused");
    expect(parsed.message).toBe("Prix trop élevé");
  });

  it("round-trips a multi-category full-mode rejection", () => {
    const encoded = encodeRejection(["photos", "title"], "Deux choses", "full");
    expect(encoded).toContain("|ALL");
    const parsed = parseRejection(encoded);
    expect(parsed.categories).toEqual(["photos", "title"]);
    expect(parsed.mode).toBe("full");
  });

  it("every category survives a round-trip", () => {
    for (const c of REJECTION_CATEGORIES) {
      const parsed = parseRejection(encodeRejection(c as RejectionCategory, "msg"));
      expect(parsed.category).toBe(c);
    }
  });
});
