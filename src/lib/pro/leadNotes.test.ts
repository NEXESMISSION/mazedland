import { describe, it, expect } from "vitest";
import { addNoteLine, callBackChoices, NOTE_MAX, shortDay } from "./leadNotes";

describe("shortDay", () => {
  it("writes the day the Tunisian way", () => {
    expect(shortDay("2026-10-26")).toBe("26/10");
    expect(shortDay("2026-01-05")).toBe("05/01");
  });
  it("leaves anything else as it is", () => {
    expect(shortDay("demain")).toBe("demain");
  });
});

describe("addNoteLine", () => {
  it("starts an empty note with the dated line", () => {
    expect(addNoteLine("", "Rappelé", "2026-10-26")).toBe("26/10 · Rappelé");
    expect(addNoteLine("  \n ", " Rappelé ", "2026-10-26")).toBe("26/10 · Rappelé");
  });
  it("puts the newest line on top of what was written", () => {
    expect(addNoteLine("Cherche un S+2 à La Marsa\n", "Visite prévue", "2026-10-27")).toBe(
      "27/10 · Visite prévue\nCherche un S+2 à La Marsa",
    );
    expect(addNoteLine("26/10 · Rappelé", "Offre faite", "2026-10-28")).toBe("28/10 · Offre faite\n26/10 · Rappelé");
  });
  it("keeps the new line when the note is full, cutting the oldest end", () => {
    const out = addNoteLine("x".repeat(NOTE_MAX), "Pas intéressé", "2026-10-26");
    expect(out).toHaveLength(NOTE_MAX);
    expect(out.startsWith("26/10 · Pas intéressé\n")).toBe(true);
  });
});

describe("callBackChoices", () => {
  it("offers tomorrow, three days and a week from today", () => {
    expect(callBackChoices("2026-10-26")).toEqual([
      { key: "tomorrow", day: "2026-10-27" },
      { key: "in3", day: "2026-10-29" },
      { key: "nextWeek", day: "2026-11-02" },
    ]);
  });
  it("crosses the end of a month and of a year", () => {
    expect(callBackChoices("2026-12-31")[0].day).toBe("2027-01-01");
  });
});
