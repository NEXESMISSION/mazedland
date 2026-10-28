import { describe, expect, it } from "vitest";
import { formatDate, SITE_TIME_ZONE } from "./utils";

/**
 * Dates are written in Tunis time, whatever the machine's clock: the server
 * runs in UTC, the visitor's phone in Tunis, and both must print the same
 * thing (React error #418 on /admin/paiements, 2026-10-28).
 */
describe("dates in Tunis time", () => {
  it("is Tunisia's zone", () => {
    expect(SITE_TIME_ZONE).toBe("Africa/Tunis");
  });

  it("a payment at 11:42 UTC reads 12:42", () => {
    expect(formatDate("2026-10-28T11:42:00Z", "fr", "time")).toBe("12:42");
    expect(formatDate("2026-10-28T11:42:00Z", "fr", "dateTime")).toMatch(/28 oct\. 2026.*12:42$/);
  });

  it("on a 24-hour clock, in both languages — never « 02:42 PM »", () => {
    expect(formatDate("2026-10-28T13:42:00Z", "fr", "time")).toBe("14:42");
    expect(formatDate("2026-10-28T13:42:00Z", "ar", "time")).toBe("14:42");
    expect(formatDate("2026-10-28T13:42:00Z", "fr", "dateTime")).not.toMatch(/PM|AM/);
  });

  it("late in the UTC evening is already the next day in Tunis", () => {
    expect(formatDate("2026-10-28T23:30:00Z", "fr", "medium")).toBe("29 oct. 2026");
    expect(formatDate("2026-10-28T23:30:00Z", "fr", "short")).toBe("29/10/2026");
  });

  it("the same text in Arabic, from the same instant", () => {
    expect(formatDate("2026-10-28T23:30:00Z", "ar", "dayMonth")).toContain("29");
  });
});
