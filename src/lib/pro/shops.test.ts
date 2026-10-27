import { describe, it, expect } from "vitest";
import { can, canAssign, carryOver, parseShopInput, periodStart, slugify } from "./shops";

const USER = "11111111-2222-3333-4444-555555555555";

describe("rights in a shop", () => {
  it("lets the owner do everything and an agent only publish and follow clients", () => {
    expect(can("owner", "subscribe")).toBe(true);
    expect(can("admin", "manage_members")).toBe(true);
    expect(can("admin", "subscribe")).toBe(false);
    expect(can("admin", "documents")).toBe(false);
    expect(can("agent", "publish")).toBe(true);
    expect(can("agent", "edit_shop")).toBe(false);
    expect(can("agent", "clients")).toBe(true);
    expect(can("agent", "manage_listings")).toBe(false);
    expect(can(null, "publish")).toBe(false);
  });
  it("never makes a second owner, and an admin only adds agents", () => {
    expect(canAssign("owner", "admin")).toBe(true);
    expect(canAssign("owner", "owner")).toBe(false);
    expect(canAssign("admin", "agent")).toBe(true);
    expect(canAssign("admin", "admin")).toBe(false);
    expect(canAssign("agent", "agent")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes an address from a Latin name", () => {
    expect(slugify("Agence Él Médina — Sfax", "abc")).toBe("agence-el-medina-sfax");
  });
  it("falls back for a name with no Latin letters", () => {
    expect(slugify("وكالة المدينة", "A1B2C3D4E5")).toBe("agence-a1b2c3d4");
  });
});

describe("parseShopInput", () => {
  const base = { name: "Agence El Medina", kind: "agency", governorate: "Sfax" };
  it("accepts a complete form and normalises it", () => {
    const r = parseShopInput({ ...base, phone: "+216 98 123 456", website: "elmedina.tn", logo_path: `${USER}/logo.webp` }, USER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phone).toBe("+21698123456");
      expect(r.value.website).toBe("https://elmedina.tn");
      expect(r.value.logo_path).toBe(`${USER}/logo.webp`);
    }
  });
  it("names the field that is wrong", () => {
    expect(parseShopInput({ ...base, name: "x" }, USER)).toEqual({ ok: false, error: "name" });
    expect(parseShopInput({ ...base, kind: "bank" }, USER)).toEqual({ ok: false, error: "kind" });
    expect(parseShopInput({ ...base, governorate: "Paris" }, USER)).toEqual({ ok: false, error: "governorate" });
    expect(parseShopInput({ ...base, phone: "12" }, USER)).toEqual({ ok: false, error: "phone" });
    expect(parseShopInput({ ...base, email: "nope" }, USER)).toEqual({ ok: false, error: "email" });
  });
  it("refuses a logo stored under someone else's folder", () => {
    const r = parseShopInput({ ...base, logo_path: "someone-else/logo.webp" }, USER);
    expect(r.ok && r.value.logo_path).toBeNull();
  });
});

describe("periodStart", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const in20Days = new Date("2026-11-16T12:00:00Z");

  it("starts the first plan today", () => {
    expect(periodStart({ now, quota: 10, runningQuota: null, paidUntil: null })).toEqual(now);
  });

  it("starts a bigger plan at once, mid-period (Starter 10 → Pro 40)", () => {
    expect(periodStart({ now, quota: 40, runningQuota: 10, paidUntil: in20Days })).toEqual(now);
  });

  it("puts the same plan after what is already paid for, never cutting it short", () => {
    expect(periodStart({ now, quota: 10, runningQuota: 10, paidUntil: in20Days })).toEqual(in20Days);
  });

  it("puts a smaller plan after the bigger one ends", () => {
    expect(periodStart({ now, quota: 10, runningQuota: 40, paidUntil: in20Days })).toEqual(in20Days);
  });

  it("starts today once what was paid for has ended", () => {
    expect(periodStart({ now, quota: 10, runningQuota: null, paidUntil: new Date("2026-10-01T00:00:00Z") })).toEqual(now);
  });
});

describe("carryOver", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const day = 86_400_000;
  const at = (d: number) => new Date(now.getTime() + d * day);

  it("adds the days left on the running smaller plan, and ends it today", () => {
    const r = carryOver({ now, quota: 40, periods: [{ id: "starter", quota: 10, startsAt: at(-10), endsAt: at(20) }] });
    expect(r.carriedMs).toBe(20 * day);
    expect(r.endNow).toEqual(["starter"]);
    expect(r.cancel).toEqual([]);
  });

  it("adds a smaller period paid in advance too, and cancels it", () => {
    const r = carryOver({
      now,
      quota: 40,
      periods: [
        { id: "running", quota: 10, startsAt: at(-10), endsAt: at(20) },
        { id: "renewal", quota: 10, startsAt: at(20), endsAt: at(50) },
      ],
    });
    expect(r.carriedMs).toBe(50 * day);
    expect(r.endNow).toEqual(["running"]);
    expect(r.cancel).toEqual(["renewal"]);
  });

  it("leaves periods of the same plan or a bigger one, and those already over", () => {
    const r = carryOver({
      now,
      quota: 40,
      periods: [
        { id: "same", quota: 40, startsAt: at(5), endsAt: at(35) },
        { id: "bigger", quota: 120, startsAt: at(-1), endsAt: at(29) },
        { id: "over", quota: 10, startsAt: at(-40), endsAt: at(-10) },
      ],
    });
    expect(r).toEqual({ carriedMs: 0, endNow: [], cancel: [] });
  });
});
