import { describe, it, expect } from "vitest";
import {
  catalogueQueryFor,
  matchRequest,
  parseRequestInput,
  requestExpiresAt,
  type MatchableListing,
  type MatchableRequest,
} from "./model";

const FLAT = "11111111-1111-4111-8111-111111111111";
const VILLA = "22222222-2222-4222-8222-222222222222";

const listing = (over: Partial<MatchableListing> = {}): MatchableListing => ({
  deal_type: "sale",
  category_id: FLAT,
  governorate: "Sfax",
  price: 190_000,
  price_on_request: false,
  attributes: { area_sqm: 110, rooms: 2 },
  furnished: null,
  available_from: null,
  ...over,
});

const request = (over: Partial<MatchableRequest> = {}): MatchableRequest => ({
  deal_type: "sale",
  category_ids: [FLAT],
  governorates: ["Sfax"],
  budget_min: null,
  budget_max: 200_000,
  surface_min: null,
  rooms_min: 2,
  furnished: null,
  move_in_by: null,
  ...over,
});

describe("parseRequestInput", () => {
  it("keeps a buyer's demande and drops what is not real", () => {
    const out = parseRequestInput({
      deal_type: "sale",
      category_ids: [FLAT, "not-a-uuid"],
      governorates: ["Sfax", "Atlantis"],
      budget_max: "200000",
      rooms_min: "2",
      furnished: "furnished",
      note: "  proche du centre  ",
    });
    expect(out).toEqual({
      ok: true,
      value: {
        deal_type: "sale",
        category_ids: [FLAT],
        governorates: ["Sfax"],
        budget_min: null,
        budget_max: 200_000,
        surface_min: null,
        rooms_min: 2,
        // A sale has no furniture question.
        furnished: null,
        move_in_by: null,
        note: "proche du centre",
        alerts: true,
      },
    });
  });

  it("needs a ceiling, and a floor under it", () => {
    expect(parseRequestInput({ deal_type: "rent" })).toEqual({ ok: false, error: "budget_required" });
    expect(parseRequestInput({ deal_type: "rent", budget_min: 900, budget_max: 800 })).toEqual({
      ok: false,
      error: "budget_order",
    });
    // The form sends strings; the order is checked on the numbers.
    expect(parseRequestInput({ deal_type: "sale", budget_min: "500000", budget_max: "100000" })).toEqual({
      ok: false,
      error: "budget_order",
    });
  });

  it("takes a floor equal to the ceiling", () => {
    const out = parseRequestInput({ deal_type: "rent", budget_min: 800, budget_max: 800 });
    expect(out.ok && [out.value.budget_min, out.value.budget_max]).toEqual([800, 800]);
  });
});

describe("matchRequest", () => {
  it("matches the S+2 in Sfax under 200 000 TND", () => {
    const m = matchRequest(listing(), request());
    expect(m.ok).toBe(true);
    expect(m.failed).toEqual([]);
    expect(m.score).toBe(100);
  });

  it("treats the budget as a ceiling, not a suggestion", () => {
    expect(matchRequest(listing({ price: 210_000 }), request()).failed).toEqual(["budget"]);
  });

  it("never sends a rental to a buyer", () => {
    const m = matchRequest(listing({ deal_type: "rent", price: 900 }), request());
    expect(m.ok).toBe(false);
    expect(m.failed).toContain("deal");
  });

  it("reports what the annonce does not say instead of failing it", () => {
    const studio = listing({ deal_type: "rent", price: 750, attributes: { area_sqm: 40, rooms: 1 } });
    const m = matchRequest(
      studio,
      request({ deal_type: "rent", budget_max: 800, rooms_min: null, furnished: "furnished", move_in_by: "2026-12-01" }),
    );
    expect(m.ok).toBe(true);
    expect(m.unknown).toEqual(["furnished", "move_in"]);
    expect(m.score).toBe(67);
  });

  it("checks the date and the furniture when they are stated", () => {
    const studio = listing({
      deal_type: "rent",
      price: 750,
      furnished: "unfurnished",
      available_from: "2027-01-15",
    });
    const m = matchRequest(
      studio,
      request({ deal_type: "rent", budget_max: 800, rooms_min: null, furnished: "furnished", move_in_by: "2026-12-01" }),
    );
    expect(m.failed).toEqual(["furnished", "move_in"]);
  });

  it("leaves a price on request unchecked", () => {
    const m = matchRequest(listing({ price: null, price_on_request: true }), request());
    expect(m.ok).toBe(true);
    expect(m.unknown).toContain("budget");
  });

  it("respects the categories and places asked for", () => {
    expect(matchRequest(listing({ category_id: VILLA }), request()).failed).toEqual(["category"]);
    expect(matchRequest(listing({ governorate: "Tunis" }), request()).failed).toEqual(["governorate"]);
    expect(matchRequest(listing({ governorate: "Tunis" }), request({ governorates: [] })).ok).toBe(true);
  });
});

describe("catalogueQueryFor", () => {
  it("turns a demande into the catalogue search it stands for", () => {
    const q = catalogueQueryFor(
      request({ deal_type: "rent", budget_max: 800, furnished: "furnished", move_in_by: "2026-12-01" }),
      new Map([[FLAT, "appartements"]]),
    );
    expect(q).toBe("/annonces?deal=rent&cat=appartements&gov=Sfax&max=800&rooms=2&furnished=furnished&avail=2026-12-01");
  });
});

describe("requestExpiresAt", () => {
  it("counts the console's number of days from now", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    expect(requestExpiresAt(60, now)).toBe("2026-12-25T10:00:00.000Z");
    expect(requestExpiresAt(7, now)).toBe("2026-11-02T10:00:00.000Z");
  });
});
