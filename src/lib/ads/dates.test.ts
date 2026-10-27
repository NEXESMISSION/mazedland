import { describe, it, expect } from "vitest";
import { addMonths, campaignDays, campaignWindow, lastDays, monthsFrom, tunisMidnight } from "./dates";

describe("tunisMidnight", () => {
  it("is 23:00 UTC the day before — Tunisia is UTC+1 all year", () => {
    expect(tunisMidnight("2026-10-27")).toBe("2026-10-26T23:00:00.000Z");
    expect(tunisMidnight("2026-07-01")).toBe("2026-06-30T23:00:00.000Z");
  });
});

describe("campaignWindow", () => {
  it("runs from the first day's midnight to the midnight after the last day", () => {
    expect(campaignWindow("2026-10-27", "2026-11-26")).toEqual({
      starts_at: "2026-10-26T23:00:00.000Z",
      ends_at: "2026-11-26T23:00:00.000Z",
    });
  });

  it("allows a one-day campaign", () => {
    const w = campaignWindow("2026-10-27", "2026-10-27")!;
    expect(Date.parse(w.ends_at!) - Date.parse(w.starts_at!)).toBe(86_400_000);
  });

  it("leaves a missing day open", () => {
    expect(campaignWindow(null, null)).toEqual({ starts_at: null, ends_at: null });
    expect(campaignWindow("2026-10-27", null)).toEqual({ starts_at: "2026-10-26T23:00:00.000Z", ends_at: null });
  });

  it("refuses an end before the start, or a day that does not exist", () => {
    expect(campaignWindow("2026-10-27", "2026-10-26")).toBeNull();
    expect(campaignWindow("2026-02-30", null)).toBeNull();
    expect(campaignWindow(null, "demain")).toBeNull();
  });
});

describe("campaignDays", () => {
  it("gives back the days the admin picked", () => {
    const w = campaignWindow("2026-10-27", "2026-11-26")!;
    expect(campaignDays(w.starts_at, w.ends_at)).toEqual({ startDay: "2026-10-27", endDay: "2026-11-26" });
    expect(campaignDays(null, null)).toEqual({ startDay: null, endDay: null });
  });

  it("reads an instant in Tunis time", () => {
    // 23:30 UTC on the 26th is already the 27th in Tunis.
    expect(campaignDays("2026-10-26T23:30:00Z", null).startDay).toBe("2026-10-27");
  });
});

describe("addMonths / monthsFrom", () => {
  it("moves by whole months, clamping the 31st", () => {
    expect(addMonths("2026-10-27", 1)).toBe("2026-11-27");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("makes « +1 mois » end the day before the same date next month", () => {
    expect(monthsFrom("2026-10-27", 1)).toBe("2026-11-26");
    expect(monthsFrom("2026-10-27", 3)).toBe("2027-01-26");
    expect(monthsFrom("2026-11-01", 1)).toBe("2026-11-30");
  });
});

describe("lastDays", () => {
  it("lists the last n days, oldest first, with zeros for the empty ones", () => {
    const days = lastDays([{ day: "2026-10-26", views: 40, clicks: 2 }], "2026-10-27", 3);
    expect(days).toEqual([
      { day: "2026-10-25", views: 0, clicks: 0 },
      { day: "2026-10-26", views: 40, clicks: 2 },
      { day: "2026-10-27", views: 0, clicks: 0 },
    ]);
  });

  it("gives 30 days by default, across a month", () => {
    const days = lastDays([], "2026-11-05");
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe("2026-10-07");
    expect(days[29].day).toBe("2026-11-05");
  });
});
