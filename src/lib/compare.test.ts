import { describe, it, expect } from "vitest";
import { bestOf, comparable, parseCompareIds, pricePerSqm } from "./compare";

const A = "0e50b8e7-1f29-4c37-9b5b-49cf3bd83c63";
const B = "ba11a5bd-0d59-43dd-87db-68a18e509074";
const C = "8751310c-9c5a-41de-8e37-e74aba9d2b57";
const D = "2c8b1edb-98d0-4dbc-bdd2-c517515ddb18";

describe("parseCompareIds", () => {
  it("keeps real ids, once each, three at most by default", () => {
    expect(parseCompareIds(`${A},${B},${A},nope,${C},${D}`)).toEqual([A, B, C]);
    expect(parseCompareIds(undefined)).toEqual([]);
    expect(parseCompareIds([A, B])).toEqual([A, B]);
  });

  it("follows the console's maximum", () => {
    expect(parseCompareIds(`${A},${B},${C},${D}`, 4)).toEqual([A, B, C, D]);
    expect(parseCompareIds(`${A},${B},${A},${C}`, 2)).toEqual([A, B]);
  });
});

describe("comparable and bestOf", () => {
  const row = (id: string, price: number | null, area?: number, rooms?: number, onRequest = false) =>
    comparable({ id, price, price_on_request: onRequest, attributes: { area_sqm: area, rooms } });
  const rental = (id: string, rent: number, area?: number) =>
    comparable({ id, deal_type: "rent", price: rent, price_on_request: false, attributes: { area_sqm: area } });

  it("reads price, surface and rooms, and leaves out a price on request", () => {
    expect(row(A, 300000, 120, 3)).toEqual({ id: A, deal: "sale", price: 300000, area: 120, rooms: 3 });
    expect(row(A, 300000, undefined, undefined, true)).toEqual({ id: A, deal: "sale", price: null, area: null, rooms: null });
    expect(pricePerSqm(row(A, 300000, 120))).toBe(2500);
  });

  it("keeps a rental's price a monthly rent", () => {
    expect(rental(A, 1200, 80)).toMatchObject({ deal: "rent", price: 1200 });
    expect(pricePerSqm(rental(A, 1200, 80))).toBe(15);
  });

  it("gives no money trophy between a sale and a rental", () => {
    const best = bestOf([row(A, 300000, 120), rental(B, 1200, 80)]);
    expect(best.price).toBeNull();
    expect(best.perSqm).toBeNull();
    // Surface is surface, whatever the deal.
    expect(best.area).toBe(A);
    expect(bestOf([rental(A, 1200, 80), rental(B, 900, 90)]).perSqm).toBe(B); // 15 vs 10
  });

  it("names the best on each line, and nobody on a tie or with one value", () => {
    const best = bestOf([row(A, 300000, 120, 3), row(B, 250000, 80, 3), row(C, null, 150)]);
    expect(best.price).toBe(B);
    expect(best.perSqm).toBe(A); // 2500 vs 3125
    expect(best.area).toBe(C);
    expect(best.rooms).toBeNull(); // 3 and 3
    expect(bestOf([row(A, 1), row(B, null)]).price).toBeNull();
  });
});
