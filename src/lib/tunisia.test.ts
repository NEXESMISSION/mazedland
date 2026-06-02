import { describe, it, expect } from "vitest";
import { normalizeE164, validatePhone, splitE164, TUNISIAN_GOVERNORATES } from "./tunisia";

describe("normalizeE164", () => {
  it("accepts an 8-digit Tunisian number and strips leading zeros/spaces", () => {
    expect(normalizeE164("+216", "20 123 456")).toBe("+21620123456");
    expect(normalizeE164("+216", "020123456")).toBe("+21620123456"); // leading 0 dropped
  });
  it("rejects a Tunisian number that isn't exactly 8 digits", () => {
    expect(normalizeE164("+216", "1234567")).toBeNull(); // 7
    expect(normalizeE164("+216", "123456789")).toBeNull(); // 9
  });
  it("applies the 6–15 digit E.164 range for other dial codes", () => {
    expect(normalizeE164("+33", "612345678")).toBe("+33612345678");
    expect(normalizeE164("+33", "12345")).toBeNull(); // too short
  });
  it("returns null on empty input", () => {
    expect(normalizeE164("+216", "")).toBeNull();
    expect(normalizeE164("+216", "----")).toBeNull();
  });
});

describe("validatePhone", () => {
  it("ok for a valid Tunisian number", () => {
    expect(validatePhone("+216", "20123456")).toEqual({ ok: true });
  });
  it("explains the Tunisian 8-digit rule on failure", () => {
    const r = validatePhone("+216", "201234");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("8 chiffres");
  });
  it("flags empty, too-short and too-long for foreign codes", () => {
    expect(validatePhone("+216", "").ok).toBe(false);
    expect(validatePhone("+1", "123").ok).toBe(false);
    expect(validatePhone("+1", "1234567890123456").ok).toBe(false);
  });
});

describe("splitE164", () => {
  it("splits a known dial code back into (code, local)", () => {
    expect(splitE164("+21620123456")).toEqual({ dialCode: "+216", number: "20123456" });
  });
  it("falls back to the default code for unknown prefixes", () => {
    const out = splitE164("999999", "+216");
    expect(out.dialCode).toBe("+216");
  });
});

describe("TUNISIAN_GOVERNORATES", () => {
  it("covers the 24 governorates and includes the majors", () => {
    expect(TUNISIAN_GOVERNORATES.length).toBe(24);
    expect(TUNISIAN_GOVERNORATES).toContain("Tunis");
    expect(TUNISIAN_GOVERNORATES).toContain("Sfax");
  });
});
