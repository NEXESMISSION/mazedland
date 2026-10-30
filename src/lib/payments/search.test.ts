import { describe, it, expect } from "vitest";
import { parsePaymentSearch, uuidRangeForPrefix } from "./search";

// The reference on a transfer is the payment id's first eight characters: the
// queue finds it as a range on `id`, with nothing stored for it.
describe("uuidRangeForPrefix()", () => {
  it("bounds every id that starts with the digits", () => {
    expect(uuidRangeForPrefix("c243037d")).toEqual([
      "c243037d-0000-0000-0000-000000000000",
      "c243037d-ffff-ffff-ffff-ffffffffffff",
    ]);
    expect(uuidRangeForPrefix("C243037D-1A")).toEqual([
      "c243037d-1a00-0000-0000-000000000000",
      "c243037d-1aff-ffff-ffff-ffffffffffff",
    ]);
  });

  it("a whole id bounds itself; anything else is no range", () => {
    const id = "c243037d-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    expect(uuidRangeForPrefix(id)).toEqual([id, id]);
    expect(uuidRangeForPrefix("")).toBeNull();
    expect(uuidRangeForPrefix("xyz")).toBeNull();
    expect(uuidRangeForPrefix(`${id}0`)).toBeNull();
  });
});

describe("parsePaymentSearch()", () => {
  it("reads the printed reference, with or without its prefix", () => {
    for (const typed of ["MAZED IMMO-C243037D", "mazed immo c243037d", "MAZEDIMMO_C243037D", " c243037d "]) {
      expect(parsePaymentSearch(typed).idRange?.[0]).toBe("c243037d-0000-0000-0000-000000000000");
    }
  });

  it("keeps the words for the name, the phone and the motif", () => {
    expect(parsePaymentSearch("  Ben Salah ")).toEqual({ idRange: null, text: "Ben Salah" });
    expect(parsePaymentSearch("55 123 456").idRange).toBeNull();
    expect(parsePaymentSearch("MAZED IMMO-C243037D").text).toBe("MAZED IMMO-C243037D");
  });

  it("does not take two letters for an id", () => {
    expect(parsePaymentSearch("ab").idRange).toBeNull();
    expect(parsePaymentSearch("dada").idRange).not.toBeNull();
  });
});
