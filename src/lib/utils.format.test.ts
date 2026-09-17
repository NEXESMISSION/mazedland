import { describe, it, expect } from "vitest";
import { formatNumber, formatTND } from "./utils";

describe("number formatting", () => {
  it("groups thousands with a visible no-break space", () => {
    expect(formatTND(850000)).toBe("850\u00a0000");
    expect(formatNumber(13000)).toBe("13\u00a0000");
    expect(formatNumber(950)).toBe("950");
  });

  it("never emits the narrow no-break space the font draws invisibly", () => {
    expect(formatTND(1234567)).not.toContain("\u202f");
    expect(formatNumber(1234567)).not.toContain("\u202f");
  });
});
