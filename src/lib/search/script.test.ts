import { describe, it, expect } from "vitest";
import { isMostlyArabic } from "./script";

describe("isMostlyArabic", () => {
  it("is true for a search typed in Arabic, numbers and S+2 included", () => {
    expect(isMostlyArabic("شقة للكراء في سوسة")).toBe(true);
    expect(isMostlyArabic("أرض صفاقس 300 مليون")).toBe(true);
    expect(isMostlyArabic("S+2 المرسى")).toBe(true);
  });

  it("is false for French, for one Arabic word in a French search, and for nothing", () => {
    expect(isMostlyArabic("appartement la marsa")).toBe(false);
    expect(isMostlyArabic("villa à vendre sfax صفاقس")).toBe(false);
    expect(isMostlyArabic("ب")).toBe(false);
    expect(isMostlyArabic("")).toBe(false);
    expect(isMostlyArabic(null)).toBe(false);
  });
});
