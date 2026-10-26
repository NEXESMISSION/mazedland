import { describe, it, expect } from "vitest";
import { inputsInverted, rangeInverted, usableRange } from "./range";

describe("rangeInverted", () => {
  it("is a floor above the ceiling, nothing else", () => {
    expect(rangeInverted(500_000, 100_000)).toBe(true);
    expect(rangeInverted(100_000, 500_000)).toBe(false);
    // The same number twice is a fair range: exactly that price.
    expect(rangeInverted(100_000, 100_000)).toBe(false);
  });

  it("needs both bounds", () => {
    expect(rangeInverted(500_000, null)).toBe(false);
    expect(rangeInverted(undefined, 100_000)).toBe(false);
    expect(rangeInverted(null, null)).toBe(false);
  });
});

describe("usableRange", () => {
  it("keeps a fair range, or one bound alone", () => {
    expect(usableRange(100_000, 500_000)).toEqual({ min: 100_000, max: 500_000, inverted: false });
    expect(usableRange(null, 500_000)).toEqual({ min: null, max: 500_000, inverted: false });
    expect(usableRange(100_000, undefined)).toEqual({ min: 100_000, max: null, inverted: false });
  });

  it("drops an inverted range whole and says so", () => {
    expect(usableRange(500_000, 100_000)).toEqual({ min: null, max: null, inverted: true });
  });
});

describe("inputsInverted", () => {
  it("reads what two inputs hold", () => {
    expect(inputsInverted("500000", "100000")).toBe(true);
    expect(inputsInverted(" 100000 ", "500000")).toBe(false);
    expect(inputsInverted("100000", "100000")).toBe(false);
  });

  it("treats an empty, zero or unreadable field as no bound", () => {
    expect(inputsInverted("500000", "")).toBe(false);
    expect(inputsInverted("", "100000")).toBe(false);
    expect(inputsInverted("500000", "0")).toBe(false);
    expect(inputsInverted("abc", "100")).toBe(false);
  });
});
