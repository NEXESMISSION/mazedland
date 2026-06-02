import { describe, it, expect } from "vitest";
import { minBidIncrement, formatTND, cn } from "./utils";

describe("minBidIncrement (bid ladder, plan §8)", () => {
  it("uses 1,000 below 100k", () => {
    expect(minBidIncrement(0)).toBe(1_000);
    expect(minBidIncrement(99_999)).toBe(1_000);
  });
  it("uses 5,000 in 100k..500k", () => {
    expect(minBidIncrement(100_000)).toBe(5_000);
    expect(minBidIncrement(499_999)).toBe(5_000);
  });
  it("uses 10,000 in 500k..1M", () => {
    expect(minBidIncrement(500_000)).toBe(10_000);
    expect(minBidIncrement(999_999)).toBe(10_000);
  });
  it("uses 25,000 at/above 1M", () => {
    expect(minBidIncrement(1_000_000)).toBe(25_000);
    expect(minBidIncrement(5_000_000)).toBe(25_000);
  });
});

describe("formatTND", () => {
  it("renders whole dinars with no decimals", () => {
    const out = formatTND(1234567);
    expect(out).not.toContain(".");
    // grouping char varies by ICU build; just assert the digits survive.
    expect(out.replace(/\D/g, "")).toBe("1234567");
  });
  it("supports compact notation", () => {
    expect(typeof formatTND(1_500_000, "en", { compact: true })).toBe("string");
  });
});

describe("cn", () => {
  it("merges and de-conflicts tailwind classes", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});
