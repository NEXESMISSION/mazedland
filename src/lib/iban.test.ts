import { describe, it, expect } from "vitest";
import { normalizeIban, looksLikeIban, isValidIban, formatIbanForDisplay } from "./iban";

describe("normalizeIban", () => {
  it("strips spaces and uppercases", () => {
    expect(normalizeIban("tn59 1000 6035")).toBe("TN5910006035");
  });
  it("returns empty string for non-strings", () => {
    expect(normalizeIban(null)).toBe("");
    expect(normalizeIban(undefined)).toBe("");
    expect(normalizeIban(123)).toBe("");
  });
});

describe("looksLikeIban", () => {
  it("accepts well-formed IBAN shapes", () => {
    expect(looksLikeIban("TN5910006035000010050169")).toBe(true);
    expect(looksLikeIban("DE89370400440532013000")).toBe(true);
  });
  it("rejects malformed shapes", () => {
    expect(looksLikeIban("T5910006035")).toBe(false); // one letter
    expect(looksLikeIban("TNXX10006035")).toBe(false); // non-digit check
    expect(looksLikeIban("")).toBe(false);
  });
});

describe("isValidIban (mod-97)", () => {
  it("accepts valid IBANs from multiple countries", () => {
    // Known-valid published example IBANs.
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(isValidIban("FR14 2004 1010 0505 0001 3M02 606")).toBe(true);
  });
  it("rejects a transposed-digit typo that passes a length check", () => {
    // Valid DE IBAN with two digits swapped -> still 22 chars, fails mod-97.
    expect(isValidIban("DE89 3704 0044 0532 0130 09")).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isValidIban("not-an-iban")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });
});

describe("formatIbanForDisplay", () => {
  it("groups into 4-char blocks", () => {
    expect(formatIbanForDisplay("DE89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });
});
