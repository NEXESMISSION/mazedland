import { describe, it, expect } from "vitest";
import { isIsoInstant } from "./isoInstant";

describe("isIsoInstant", () => {
  it("takes a day, a minute, a second and a zone, as the form and the database write them", () => {
    expect(isIsoInstant("2026-02-15")).toBe(true);
    expect(isIsoInstant("2026-02-15T10:00")).toBe(true);
    expect(isIsoInstant("2026-02-15T10:00:00Z")).toBe(true);
    expect(isIsoInstant("2026-02-15T10:00:00.000Z")).toBe(true);
    expect(isIsoInstant("2026-02-15T10:00:00+01:00")).toBe(true);
    expect(isIsoInstant("2024-02-29")).toBe(true);
  });

  it("refuses what Date.parse lets through and Postgres does not", () => {
    expect(isIsoInstant("2026-02-30")).toBe(false);
    expect(isIsoInstant("2026-02-30T10:00:00Z")).toBe(false);
    expect(isIsoInstant("2023-02-29")).toBe(false);
    expect(isIsoInstant("1")).toBe(false);
    expect(isIsoInstant("Feb 30 2026")).toBe(false);
    expect(isIsoInstant("2026-13-01")).toBe(false);
    expect(isIsoInstant("2026-02-15T24:00:00Z")).toBe(false);
    expect(isIsoInstant("2026-02-15T10:60")).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    expect(isIsoInstant("")).toBe(false);
    expect(isIsoInstant("garbage")).toBe(false);
    expect(isIsoInstant(null)).toBe(false);
    expect(isIsoInstant(1_700_000_000)).toBe(false);
    expect(isIsoInstant(new Date())).toBe(false);
  });
});
