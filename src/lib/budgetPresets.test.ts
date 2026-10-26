import { describe, it, expect } from "vitest";
import { BUDGET_PRESETS, budgetChipLabel, budgetChoice } from "./budgetPresets";

describe("BUDGET_PRESETS", () => {
  it("climbs, on two scales: a sale in thousands, a rent by the month", () => {
    for (const deal of ["sale", "rent"] as const) {
      for (const list of [BUDGET_PRESETS[deal].ceilings, BUDGET_PRESETS[deal].floors]) {
        expect(list.length).toBeGreaterThan(2);
        for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThan(list[i - 1]);
      }
    }
    expect(Math.min(...BUDGET_PRESETS.sale.ceilings)).toBeGreaterThan(Math.max(...BUDGET_PRESETS.rent.ceilings));
  });

  it("leaves a ceiling above every floor, so a floor chip never empties the max row", () => {
    for (const deal of ["sale", "rent"] as const) {
      const { ceilings, floors } = BUDGET_PRESETS[deal];
      for (const f of floors) expect(ceilings.some((c) => c > f)).toBe(true);
    }
  });
});

describe("budgetChoice", () => {
  const ceilings = BUDGET_PRESETS.sale.ceilings;

  it("is the chip of a preset ceiling with no floor", () => {
    expect(budgetChoice("", "300000", ceilings)).toBe(300_000);
  });

  it("is « Autre budget » for a typed ceiling, or any floor", () => {
    expect(budgetChoice("", "275000", ceilings)).toBe("other");
    expect(budgetChoice("100000", "300000", ceilings)).toBe("other");
    expect(budgetChoice("100000", "", ceilings)).toBe("other");
  });

  it("is nothing while there is no budget", () => {
    expect(budgetChoice("", "", ceilings)).toBeNull();
    expect(budgetChoice("0", "0", ceilings)).toBeNull();
  });
});

describe("budgetChipLabel", () => {
  it("says a sale the way the catalogue's brackets do", () => {
    expect(budgetChipLabel(300_000, "sale", "fr")).toMatch(/^300\sk$/);
    expect(budgetChipLabel(1_000_000, "sale", "fr")).toMatch(/^1\sM$/);
    expect(budgetChipLabel(300_000, "sale", "ar")).toMatch(/^300\sألف$/);
  });

  it("never rounds: a rent, or an amount the short form would round, is said in full", () => {
    expect(budgetChipLabel(1_500, "rent", "fr")).toMatch(/^1\s500$/);
    expect(budgetChipLabel(1_500_000, "sale", "fr")).toMatch(/^1\s500\s000$/);
    expect(budgetChipLabel(800, "rent", "ar")).toBe("800");
  });

  it("gives two presets two different labels, in both languages", () => {
    for (const deal of ["sale", "rent"] as const) {
      const all = [...new Set([...BUDGET_PRESETS[deal].ceilings, ...BUDGET_PRESETS[deal].floors])];
      for (const locale of ["fr", "ar"]) {
        expect(new Set(all.map((n) => budgetChipLabel(n, deal, locale))).size).toBe(all.length);
      }
    }
  });
});
