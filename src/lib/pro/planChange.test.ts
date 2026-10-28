import { describe, expect, it } from "vitest";
import { addMonths, monthsOf, quotePlanChange, type PlanPeriod } from "./planChange";

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const STARTER = { quota: 10, price: 29 };
const PRO = { quota: 40, price: 59 };
const BUSINESS = { quota: 120, price: 119 };
const period = (id: string, plan: { quota: number; price: number }, from: string, to: string, paid = true): PlanPeriod => ({
  id, quota: plan.quota, price: plan.price, paid, startsAt: d(from), endsAt: d(to),
});
const target = (plan: { quota: number; price: number }) => ({ ...plan, months: 1 });

describe("changing an agence's plan", () => {
  it("runs a month: from the day it is paid to the same day next month", () => {
    expect(addMonths(d("2026-10-28"), 1).toISOString().slice(0, 10)).toBe("2026-11-28");
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(d("2026-12-15"), 1).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(monthsOf(30)).toBe(1);
    expect(monthsOf(90)).toBe(3);
  });

  it("a first plan: the full price, from today", () => {
    const q = quotePlanChange({ now: d("2026-10-28"), target: target(STARTER), periods: [], renewDays: 5 });
    expect(q).toMatchObject({ kind: "new", amount: 29 });
    if (q.kind === "new") expect(q.endsAt.toISOString().slice(0, 10)).toBe("2026-11-28");
  });

  it("the owner's example: Starter on the 26th, Business two days later — the unused Starter is a discount", () => {
    const starter = period("s", STARTER, "2026-10-26", "2026-11-26");
    const q = quotePlanChange({ now: d("2026-10-28"), target: target(BUSINESS), periods: [starter], renewDays: 5 });
    expect(q.kind).toBe("upgrade");
    if (q.kind !== "upgrade") return;
    // 29 DT × 29 days left of 31 = 27.13 → 27 DT off, 92 DT to pay.
    expect(q.credit).toBe(27);
    expect(q.amount).toBe(92);
    expect(q.lines).toEqual([{ periodId: "s", days: 29, amount: 27 }]);
    expect(q.replaces).toEqual(["s"]);
    // A month from the day it is paid — not a month plus the days left.
    expect(q.startsAt.toISOString().slice(0, 10)).toBe("2026-10-28");
    expect(q.endsAt.toISOString().slice(0, 10)).toBe("2026-11-28");
  });

  it("a week into Starter, Pro: about three quarters of Starter come off", () => {
    const q = quotePlanChange({ now: d("2026-11-02"), target: target(PRO), periods: [period("s", STARTER, "2026-10-26", "2026-11-26")], renewDays: 5 });
    if (q.kind !== "upgrade") throw new Error(q.kind);
    expect(q.credit).toBe(22); // 29 × 24/31 = 22.45
    expect(q.amount).toBe(37);
  });

  it("a Starter renewal already paid ahead counts whole, and is replaced too", () => {
    const q = quotePlanChange({
      now: d("2026-10-28"),
      target: target(BUSINESS),
      periods: [period("s1", STARTER, "2026-10-26", "2026-11-26"), period("s2", STARTER, "2026-11-26", "2026-12-26")],
      renewDays: 5,
    });
    if (q.kind !== "upgrade") throw new Error(q.kind);
    expect(q.replaces.sort()).toEqual(["s1", "s2"]);
    expect(q.credit).toBe(56); // 27.13 + 29
    expect(q.amount).toBe(63);
  });

  it("a period an admin gave for free is no discount", () => {
    const q = quotePlanChange({ now: d("2026-10-28"), target: target(PRO), periods: [period("gift", STARTER, "2026-10-26", "2026-11-26", false)], renewDays: 5 });
    if (q.kind !== "upgrade") throw new Error(q.kind);
    expect(q.credit).toBe(0);
    expect(q.amount).toBe(59);
    expect(q.replaces).toEqual(["gift"]);
  });

  it("the discount never makes the new plan free or negative", () => {
    const q = quotePlanChange({
      now: d("2026-10-28"),
      target: target({ quota: 20, price: 30 }),
      periods: [period("a", { quota: 15, price: 100 }, "2026-10-27", "2026-11-27")],
      renewDays: 5,
    });
    if (q.kind !== "upgrade") throw new Error(q.kind);
    expect(q.credit).toBe(30);
    expect(q.amount).toBe(0);
  });

  it("a smaller plan waits for the end of what is paid for", () => {
    const q = quotePlanChange({ now: d("2026-10-28"), target: target(STARTER), periods: [period("b", BUSINESS, "2026-10-20", "2026-11-20")], renewDays: 5 });
    expect(q).toMatchObject({ kind: "downgrade", amount: 29 });
    if (q.kind === "downgrade") {
      expect(q.startsAt.toISOString().slice(0, 10)).toBe("2026-11-20");
      expect(q.endsAt.toISOString().slice(0, 10)).toBe("2026-12-20");
    }
  });

  it("the same plan while it runs: « you have it until … », renewable in its last days", () => {
    const pro = period("p", PRO, "2026-10-20", "2026-11-20");
    const early = quotePlanChange({ now: d("2026-10-28"), target: target(PRO), periods: [pro], renewDays: 5 });
    expect(early).toMatchObject({ kind: "same" });
    if (early.kind === "same") {
      expect(early.until.toISOString().slice(0, 10)).toBe("2026-11-20");
      expect(early.renewFrom.toISOString().slice(0, 10)).toBe("2026-11-15");
    }
    const late = quotePlanChange({ now: d("2026-11-17"), target: target(PRO), periods: [pro], renewDays: 5 });
    expect(late).toMatchObject({ kind: "renew", amount: 59 });
    if (late.kind === "renew") expect(late.startsAt.toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("periods that ended are ignored", () => {
    const q = quotePlanChange({ now: d("2026-12-01"), target: target(PRO), periods: [period("old", STARTER, "2026-10-01", "2026-11-01")], renewDays: 5 });
    expect(q.kind).toBe("new");
  });
});
