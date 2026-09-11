import { describe, it, expect } from "vitest";
import { formatTND, cn } from "./utils";

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
