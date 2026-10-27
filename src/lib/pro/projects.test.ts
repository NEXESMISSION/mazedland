import { describe, expect, it } from "vitest";
import {
  deliveryChoices,
  isDelivery,
  parseProjectInput,
  parseUnitPatch,
  parseUnitPlan,
  planUnits,
  priceFrom,
  unitCounts,
  unitPlanSize,
} from "./projects";

describe("deliveryChoices", () => {
  it("offers « livré », then this quarter and the next ones", () => {
    expect(deliveryChoices(new Date("2026-10-27T00:00:00Z"), 4)).toEqual(["delivered", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3"]);
  });

  it("accepts only those shapes", () => {
    expect(isDelivery("delivered")).toBe(true);
    expect(isDelivery("2027-Q2")).toBe(true);
    expect(isDelivery("2027-Q5")).toBe(false);
    expect(isDelivery("bientôt")).toBe(false);
  });
});

describe("parseProjectInput", () => {
  const ok = { name: "Résidence Les Jasmins", kind: "residence", governorate: "Tunis" };

  it("takes a creation with a name, a kind and a governorate", () => {
    const r = parseProjectInput({ ...ok, delegation: "la marsa", delivery: "2027-Q2", address: "  Sidi Daoud " });
    expect(r).toEqual({
      ok: true,
      value: { name: "Résidence Les Jasmins", kind: "residence", governorate: "Tunis", delegation: "La Marsa", delivery: "2027-Q2", address: "Sidi Daoud" },
    });
  });

  it("refuses a délégation of another governorate, an unknown kind or delivery", () => {
    expect(parseProjectInput({ ...ok, delegation: "Sousse Médina" })).toEqual({ ok: false, field: "delegation" });
    expect(parseProjectInput({ ...ok, kind: "château" })).toEqual({ ok: false, field: "kind" });
    expect(parseProjectInput({ ...ok, delivery: "un jour" })).toEqual({ ok: false, field: "delivery" });
    expect(parseProjectInput({ kind: "residence", governorate: "Tunis" })).toEqual({ ok: false, field: "name" });
  });

  it("checks only the fields an edit sends", () => {
    expect(parseProjectInput({ delivery: "delivered" }, { partial: true })).toEqual({ ok: true, value: { delivery: "delivered" } });
  });
});

describe("planUnits", () => {
  it("numbers a building's floors: A-001 … A-202", () => {
    const plan = parseUnitPlan({ mode: "floors", kind: "apartment", block: "A", floorFrom: 0, floorTo: 2, perFloor: 2, rooms: 3, area: 120, price: 350000 });
    expect(plan).not.toBeNull();
    const units = planUnits(plan!);
    expect(units.map((u) => u.ref)).toEqual(["A-001", "A-002", "A-101", "A-102", "A-201", "A-202"]);
    expect(units[3]).toMatchObject({ kind: "apartment", block: "A", floor: 1, rooms: 3, area_sqm: 120, price: 350000, sort_order: 3 });
    expect(unitPlanSize(plan!)).toBe(6);
  });

  it("numbers lots one after the other, from a given number", () => {
    const plan = parseUnitPlan({ mode: "lots", kind: "land", from: 11, count: 3, area: 300 });
    expect(planUnits(plan!, 10).map((u) => [u.ref, u.sort_order])).toEqual([["Lot 11", 10], ["Lot 12", 11], ["Lot 13", 12]]);
  });

  it("refuses a plan that makes no sense", () => {
    expect(parseUnitPlan({ mode: "floors", kind: "apartment", block: "A", floorFrom: 3, floorTo: 1, perFloor: 2 })).toBeNull();
    expect(parseUnitPlan({ mode: "floors", kind: "land", block: "A", floorFrom: 0, floorTo: 1, perFloor: 2 })).toBeNull();
    expect(parseUnitPlan({ mode: "floors", kind: "apartment", block: "Z9", floorFrom: 0, floorTo: 1, perFloor: 2 })).toBeNull();
    expect(parseUnitPlan({ mode: "lots", kind: "land", count: 0 })).toBeNull();
    expect(parseUnitPlan({ mode: "lots", kind: "land", count: 3, price: -5 })).toMatchObject({ price: null });
  });
});

describe("parseUnitPatch", () => {
  it("takes a status or a figure, nothing negative", () => {
    expect(parseUnitPatch({ status: "reserved" })).toEqual({ ok: true, value: { status: "reserved" } });
    expect(parseUnitPatch({ price: "420000" })).toEqual({ ok: true, value: { price: 420000 } });
    expect(parseUnitPatch({ price: -1 })).toEqual({ ok: false });
    expect(parseUnitPatch({ status: "vendu" })).toEqual({ ok: false });
    expect(parseUnitPatch({})).toEqual({ ok: false });
  });
});

describe("unitCounts and priceFrom", () => {
  const units = [
    { status: "available", price: 300000 },
    { status: "available", price: 250000 },
    { status: "reserved", price: 200000 },
    { status: "sold", price: null },
  ];

  it("counts each status", () => {
    expect(unitCounts(units)).toEqual({ total: 4, available: 2, reserved: 1, sold: 1 });
  });

  it("gives the lowest price still available", () => {
    expect(priceFrom(units)).toBe(250000);
    expect(priceFrom([{ status: "sold", price: 1 }])).toBeNull();
  });
});
