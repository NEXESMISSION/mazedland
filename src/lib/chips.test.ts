import { describe, it, expect } from "vitest";
import { chipClass } from "./chips";

describe("chipClass", () => {
  it("is a 44 px tap target, a pill, in both states", () => {
    for (const on of [true, false]) {
      const c = chipClass(on).split(" ");
      expect(c).toContain("tap-target");
      expect(c).toContain("rounded-full");
    }
  });

  it("selects with the ink fill and a light label, never a dark one", () => {
    const on = chipClass(true).split(" ");
    expect(on).toContain("bg-[var(--gold)]");
    expect(on).toContain("text-[var(--background)]");
    expect(on.filter((c) => /^text-(foreground|black|gold|\[var\(--(foreground|gold)\)\])$/.test(c))).toEqual([]);
    expect(chipClass(false).split(" ")).toContain("ring-border");
  });
});
