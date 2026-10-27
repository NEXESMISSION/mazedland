import { describe, it, expect } from "vitest";
import { addDays, dayLabel, dayMonthLabel, firstsOfMonth, nextDays } from "./dayChips";

const TODAY = "2026-10-26"; // a Monday
const WORDS = { today: "Aujourd'hui", tomorrow: "Demain" };

describe("nextDays", () => {
  it("offers today and the six days after it", () => {
    expect(nextDays(TODAY, 30)).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
  });

  it("never offers a day past the console's horizon", () => {
    expect(nextDays(TODAY, 3)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
    expect(nextDays(TODAY, 0)).toEqual([TODAY]);
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("dayLabel", () => {
  it("says today and tomorrow in words", () => {
    expect(dayLabel(TODAY, TODAY, "fr", WORDS)).toBe("Aujourd'hui");
    expect(dayLabel("2026-10-27", TODAY, "fr", WORDS)).toBe("Demain");
  });

  it("says the other days by their short weekday and date, capitalised in French", () => {
    expect(dayLabel("2026-10-31", TODAY, "fr", WORDS)).toMatch(/^Sam\. 31\soct\.$/);
    expect(dayLabel("2026-11-02", TODAY, "fr", WORDS)).toMatch(/^Lun\. 2\snov\.$/);
  });

  it("speaks Arabic with Latin digits and Tunisian month names", () => {
    const s = dayLabel("2026-11-02", TODAY, "ar", { today: "اليوم", tomorrow: "غدوة" });
    expect(s).toContain("2");
    expect(s).toContain("نوفمبر");
    expect(s).toContain("الاثنين");
    expect(dayLabel(TODAY, TODAY, "ar", { today: "اليوم", tomorrow: "غدوة" })).toBe("اليوم");
  });
});

describe("firstsOfMonth", () => {
  it("gives the next three firsts of the month, after today", () => {
    expect(firstsOfMonth(TODAY)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(firstsOfMonth("2026-11-01")).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(firstsOfMonth("2026-12-31", 2)).toEqual(["2027-01-01", "2027-02-01"]);
  });
});

describe("dayMonthLabel", () => {
  it("reads « 1 déc. » and « 1 ديسمبر »", () => {
    expect(dayMonthLabel("2026-12-01", "fr")).toMatch(/^1\sdéc\.$/);
    expect(dayMonthLabel("2026-12-01", "ar")).toMatch(/^1\sديسمبر$/);
  });
});
