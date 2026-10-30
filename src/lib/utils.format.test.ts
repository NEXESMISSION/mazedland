import { describe, it, expect } from "vitest";
import { formatNumber, formatTND } from "./utils";

describe("number formatting", () => {
  it("groups thousands with a visible no-break space", () => {
    expect(formatTND(850000)).toBe("850\u00a0000");
    expect(formatNumber(13000)).toBe("13\u00a0000");
    expect(formatNumber(950)).toBe("950");
  });

  it("keeps a fraction only when asked, in the reader's notation", () => {
    expect(formatNumber(120.5)).toBe("121");
    expect(formatNumber(120.5, "fr", { maxDecimals: 1 })).toBe("120,5");
    expect(formatNumber(120.5, "ar", { maxDecimals: 1 })).toBe("120,5");
    expect(formatNumber(1200, "ar", { maxDecimals: 1 })).toBe("1\u00a0200");
  });

  it("never emits the narrow no-break space the font draws invisibly", () => {
    expect(formatTND(1234567)).not.toContain("\u202f");
    expect(formatNumber(1234567)).not.toContain("\u202f");
  });

  it("groups Arabic amounts with a space, never the dot that means millimes", () => {
    expect(formatTND(1200, "ar")).toBe("1\u00a0200");
    expect(formatTND(350000, "ar")).toBe("350\u00a0000");
    expect(formatTND(1234567, "ar")).toBe("1\u00a0234\u00a0567");
    expect(formatTND(950, "ar")).toBe("950");
  });

  it("keeps the Arabic compact words", () => {
    const out = formatTND(350000, "ar", { compact: true });
    expect(out).not.toContain(".");
    expect(out).toMatch(/^350\s\p{Script=Arabic}+$/u);
  });
});
