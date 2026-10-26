import { describe, it, expect } from "vitest";
import {
  addMonths,
  areaChipsFor,
  availableChoiceOf,
  countChipOf,
  countChipsFor,
  depositFor,
  depositMonthsOf,
  estimateChips,
  isoDayIn,
  LEASE_MONTHS,
  nameChoices,
  presetOf,
  yearOptions,
} from "./choices";

describe("countChipsFor", () => {
  it("offers chips for the three counts", () => {
    expect(countChipsFor("rooms")).toEqual({ values: [1, 2, 3, 4, 5], orMore: 6 });
    expect(countChipsFor("bathrooms")).toEqual({ values: [1, 2, 3], orMore: 4 });
    // « RDC » is 0.
    expect(countChipsFor("floor")).toEqual({ values: [0, 1, 2, 3, 4], orMore: 5 });
  });

  it("leaves every other question as it is, an admin's new one included", () => {
    expect(countChipsFor("area_sqm")).toBeNull();
    expect(countChipsFor("year_built")).toBeNull();
    expect(countChipsFor("nb_balcons")).toBeNull();
  });
});

describe("countChipOf", () => {
  const rooms = countChipsFor("rooms")!;
  const floor = countChipsFor("floor")!;

  it("lights the chip the stored number is", () => {
    expect(countChipOf(rooms, "3")).toBe(3);
    expect(countChipOf(floor, "0")).toBe(0);
  });

  it("lights « 6 et + » from 6 up", () => {
    expect(countChipOf(rooms, "6")).toBe("more");
    expect(countChipOf(rooms, "9")).toBe("more");
    expect(countChipOf(floor, "12")).toBe("more");
  });

  it("lights nothing for no answer, or one no chip holds", () => {
    expect(countChipOf(rooms, "")).toBeNull();
    expect(countChipOf(rooms, "  ")).toBeNull();
    // A basement and a half stay in the box, as typed.
    expect(countChipOf(floor, "-1")).toBeNull();
    expect(countChipOf(rooms, "2.5")).toBeNull();
    expect(countChipOf(rooms, "abc")).toBeNull();
  });
});

describe("areaChipsFor", () => {
  it("offers the surfaces sellers of each kind write", () => {
    expect(areaChipsFor("appartements").map((c) => c.value)).toEqual([60, 80, 100, 120, 150]);
    expect(areaChipsFor("villas").map((c) => c.value)).toEqual([150, 200, 300, 400]);
    expect(areaChipsFor("maisons").map((c) => c.value)).toEqual([150, 200, 300, 400]);
    expect(areaChipsFor("terrain").map((c) => c.value)).toEqual([200, 300, 500, 1000, 5000]);
    expect(areaChipsFor("bureaux").map((c) => c.value)).toEqual([30, 50, 100, 200]);
    expect(areaChipsFor("locaux-commerciaux").map((c) => c.value)).toEqual([30, 50, 100, 200]);
    expect(areaChipsFor("depots").map((c) => c.value)).toEqual([100, 300, 500, 1000]);
  });

  it("counts a farm in hectares and stores it in m²", () => {
    expect(areaChipsFor("fermes")).toEqual([
      { value: 10_000, hectares: 1 },
      { value: 20_000, hectares: 2 },
      { value: 50_000, hectares: 5 },
      { value: 100_000, hectares: 10 },
    ]);
  });

  it("offers nothing for a category it does not know", () => {
    expect(areaChipsFor("chalets")).toEqual([]);
    expect(areaChipsFor(null)).toEqual([]);
  });
});

describe("yearOptions", () => {
  it("runs from this year down to 1950", () => {
    const years = yearOptions(2026);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1950);
    expect(years).toHaveLength(2026 - 1950 + 1);
  });

  it("keeps a stored year outside the range, in its place", () => {
    const years = yearOptions(2026, "1930");
    expect(years.at(-1)).toBe(1930);
    expect(yearOptions(2026, "2027")[0]).toBe(2027);
  });

  it("adds nothing for an answer already in the list, or none", () => {
    expect(yearOptions(2026, "2000")).toHaveLength(77);
    expect(yearOptions(2026, "")).toHaveLength(77);
    expect(yearOptions(2026, "abc")).toHaveLength(77);
  });
});

describe("deposit in months", () => {
  it("is the rent times the months", () => {
    expect(depositFor("1200", 1)).toBe("1200");
    expect(depositFor("1200", 2)).toBe("2400");
    expect(depositFor("850.5", 3)).toBe("2551.5");
  });

  it("cannot be counted without a rent", () => {
    expect(depositFor("", 2)).toBeNull();
    expect(depositFor("0", 2)).toBeNull();
    expect(depositFor("abc", 2)).toBeNull();
  });

  it("is read back as months only when it is exactly that", () => {
    expect(depositMonthsOf("2400", "1200")).toBe(2);
    expect(depositMonthsOf("3600", "1200")).toBe(3);
    expect(depositMonthsOf("2000", "1200")).toBeNull();
    expect(depositMonthsOf("", "1200")).toBeNull();
    expect(depositMonthsOf("2400", "")).toBeNull();
  });
});

describe("presetOf", () => {
  it("finds the preset a stored number is", () => {
    expect(presetOf("12", LEASE_MONTHS)).toBe(12);
    expect(presetOf("1", LEASE_MONTHS)).toBe(1);
  });

  it("is null for no answer or another one", () => {
    expect(presetOf("", LEASE_MONTHS)).toBeNull();
    expect(presetOf("36", LEASE_MONTHS)).toBeNull();
  });
});

describe("dates", () => {
  it("reads today where the seller is, not in UTC", () => {
    // 23:30 UTC on the 26th is already the 27th in Tunis (UTC+1).
    const late = new Date(Date.UTC(2026, 9, 26, 23, 30));
    expect(isoDayIn(late, "Africa/Tunis")).toBe("2026-10-27");
    expect(isoDayIn(late, "UTC")).toBe("2026-10-26");
  });

  it("adds a month, landing on the last day of a shorter one", () => {
    expect(addMonths("2026-10-26", 1)).toBe("2026-11-26");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("lights « Tout de suite » for today or a day already past", () => {
    expect(availableChoiceOf("2026-10-26", "2026-10-26")).toBe("now");
    expect(availableChoiceOf("2026-10-19", "2026-10-26")).toBe("now");
  });

  it("lights « Dans 1 mois » for that day, and a picked date otherwise", () => {
    expect(availableChoiceOf("2026-11-26", "2026-10-26")).toBe("inMonth");
    expect(availableChoiceOf("2026-12-01", "2026-10-26")).toBe("date");
    expect(availableChoiceOf("", "2026-10-26")).toBeNull();
  });
});

describe("estimateChips", () => {
  it("offers the low end, the middle and the high end", () => {
    expect(estimateChips({ low: 200_000, high: 300_000 }, false)).toEqual([200_000, 250_000, 300_000]);
    expect(estimateChips({ low: 900, high: 1300 }, true)).toEqual([900, 1100, 1300]);
  });

  it("rounds the middle as the estimate is rounded", () => {
    expect(estimateChips({ low: 201_000, high: 204_000 }, false)).toEqual([201_000, 203_000, 204_000]);
    expect(estimateChips({ low: 905, high: 930 }, true)).toEqual([905, 920, 930]);
  });

  it("offers fewer when the middle lands on an end", () => {
    expect(estimateChips({ low: 1000, high: 2000 }, false)).toEqual([1000, 2000]);
    expect(estimateChips({ low: 5000, high: 5000 }, false)).toEqual([5000]);
  });

  it("offers nothing without an estimate", () => {
    expect(estimateChips(null, false)).toEqual([]);
    expect(estimateChips({ low: 0, high: 0 }, true)).toEqual([]);
  });
});

describe("nameChoices", () => {
  it("offers the whole name and the first name with an initial", () => {
    expect(nameChoices("Karim Ben Salah")).toEqual(["Karim Ben Salah", "Karim B."]);
    expect(nameChoices("  Leila   Trabelsi ")).toEqual(["Leila Trabelsi", "Leila T."]);
    expect(nameChoices("كريم بن صالح")).toEqual(["كريم بن صالح", "كريم ب."]);
  });

  it("offers one word as it is, and nothing for no name", () => {
    expect(nameChoices("Karim")).toEqual(["Karim"]);
    expect(nameChoices("")).toEqual([]);
  });
});
