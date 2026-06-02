import { describe, it, expect } from "vitest";
import {
  DEFAULT_MONETIZATION,
  DEFAULT_ANTISNIPE,
  cleanDurationDays,
  parseMonetizationSettings,
  parseAntiSnipe,
  resolveListingFee,
  resolveDeposit,
  resolvePromoDurations,
  describeFee,
} from "./pricing";

describe("cleanDurationDays", () => {
  it("returns the fallback for non-numeric / missing input", () => {
    expect(cleanDurationDays(undefined)).toBe(30);
    expect(cleanDurationDays(null)).toBe(30);
    expect(cleanDurationDays("abc")).toBe(30);
    expect(cleanDurationDays(undefined, 14)).toBe(14);
  });
  it("floors and clamps into the 1..365 window", () => {
    expect(cleanDurationDays(0)).toBe(30); // below 1 -> fallback
    expect(cleanDurationDays(7.9)).toBe(7);
    expect(cleanDurationDays(1000)).toBe(365);
    expect(cleanDurationDays(365)).toBe(365);
    expect(cleanDurationDays(1)).toBe(1);
  });
});

describe("parseMonetizationSettings", () => {
  it("falls back to defaults on an empty map", () => {
    const mon = parseMonetizationSettings(new Map());
    expect(mon).toEqual(DEFAULT_MONETIZATION);
  });

  it("reads structured values and coerces bad ones to defaults", () => {
    const mon = parseMonetizationSettings(
      new Map<string, unknown>([
        ["fee_listing_auction", { mode: "fixed", value: 40 }],
        ["deposit", { mode: "percent", value: 12, free_until: null }],
        ["promo_home", { enabled: false, value: 99, duration_days: 9999 }],
        // Bad mode falls back to the default mode for that key.
        ["fee_listing_direct", { mode: "banana", value: 5 }],
      ]),
    );
    expect(mon.feeListingAuction).toEqual({ mode: "fixed", value: 40 });
    expect(mon.deposit.value).toBe(12);
    expect(mon.promoHome.enabled).toBe(false);
    expect(mon.promoHome.duration_days).toBe(365); // clamped
    expect(mon.feeListingDirect.mode).toBe(DEFAULT_MONETIZATION.feeListingDirect.mode);
  });
});

describe("resolveListingFee", () => {
  it("free mode is always 0", () => {
    expect(resolveListingFee({ mode: "free", value: 100 }, 500_000)).toBe(0);
  });
  it("fixed mode ignores the declared price", () => {
    expect(resolveListingFee({ mode: "fixed", value: 20 }, null)).toBe(20);
    expect(resolveListingFee({ mode: "fixed", value: 20 }, 999_999)).toBe(20);
  });
  it("fixed mode never goes negative", () => {
    expect(resolveListingFee({ mode: "fixed", value: -5 }, null)).toBe(0);
  });
  it("percent mode needs a positive declared price", () => {
    expect(resolveListingFee({ mode: "percent", value: 10 }, null)).toBe(0);
    expect(resolveListingFee({ mode: "percent", value: 10 }, 0)).toBe(0);
    expect(resolveListingFee({ mode: "percent", value: 10 }, 1000)).toBe(100);
  });
  it("percent mode rounds to 2 decimals", () => {
    expect(resolveListingFee({ mode: "percent", value: 3 }, 333)).toBe(9.99);
  });
});

describe("resolveDeposit", () => {
  const now = new Date("2026-06-02T00:00:00Z");
  it("free mode requires nothing", () => {
    expect(resolveDeposit({ mode: "free", value: 0, free_until: null }, 100_000, now)).toEqual({
      required: false,
      amount: 0,
    });
  });
  it("respects an open free window regardless of mode", () => {
    const cfg = { mode: "percent" as const, value: 10, free_until: "2026-12-31T00:00:00Z" };
    expect(resolveDeposit(cfg, 100_000, now)).toEqual({ required: false, amount: 0 });
  });
  it("charges once the free window has passed", () => {
    const cfg = { mode: "percent" as const, value: 10, free_until: "2026-01-01T00:00:00Z" };
    expect(resolveDeposit(cfg, 100_000, now)).toEqual({ required: true, amount: 10_000 });
  });
  it("fixed deposit is flat", () => {
    expect(resolveDeposit({ mode: "fixed", value: 250, free_until: null }, 100_000, now)).toEqual({
      required: true,
      amount: 250,
    });
  });
});

describe("resolvePromoDurations", () => {
  it("only grants a duration for promos the seller actually bought", () => {
    const mon = DEFAULT_MONETIZATION;
    const out = resolvePromoDurations({ home_featured: true, banner: false }, mon);
    expect(out.home_featured).toBe(mon.promoHome.duration_days);
    expect(out.top_listed).toBe(0);
    expect(out.banner).toBe(0);
  });
  it("handles null promos as all-zero", () => {
    expect(resolvePromoDurations(null, DEFAULT_MONETIZATION)).toEqual({
      home_featured: 0,
      top_listed: 0,
      banner: 0,
    });
  });
});

describe("parseAntiSnipe", () => {
  it("defaults on missing input", () => {
    expect(parseAntiSnipe(undefined)).toEqual(DEFAULT_ANTISNIPE);
  });
  it("reads and clamps minutes to 0..120", () => {
    expect(parseAntiSnipe({ window_min: 3, extend_min: 7 })).toEqual({ windowMin: 3, extendMin: 7 });
    expect(parseAntiSnipe({ window_min: 999, extend_min: 999 })).toEqual({ windowMin: 120, extendMin: 120 });
    expect(parseAntiSnipe({ window_min: -1, extend_min: -1 })).toEqual(DEFAULT_ANTISNIPE);
  });
});

describe("describeFee", () => {
  it("renders human labels", () => {
    expect(describeFee({ mode: "free", value: 0 })).toBe("Gratuit");
    expect(describeFee({ mode: "percent", value: 10 })).toBe("10%");
    expect(describeFee({ mode: "fixed", value: 20 })).toBe("20 TND");
  });
});
