import { describe, it, expect } from "vitest";
import type { MatchableListing, MatchableRequest } from "@/lib/requests/model";
import { rankForRequest } from "./suggest";

const FLAT = "11111111-1111-4111-8111-111111111111";
const listing = (id: string, over: Partial<MatchableListing> = {}) => ({
  id,
  deal_type: "sale",
  category_id: FLAT,
  governorate: "Tunis",
  price: 300000,
  price_on_request: false,
  attributes: { area_sqm: 120, rooms: 3 },
  furnished: null,
  available_from: null,
  ...over,
});
const request: MatchableRequest = {
  deal_type: "sale",
  category_ids: [FLAT],
  governorates: ["Tunis"],
  budget_min: null,
  budget_max: 320000,
  surface_min: null,
  rooms_min: 2,
  furnished: null,
  move_in_by: null,
};

describe("rankForRequest", () => {
  it("never offers a rental for a purchase, and puts full matches first", () => {
    const ranked = rankForRequest(
      [
        listing("rent", { deal_type: "rent", price: 1200 }),
        listing("too-dear", { price: 400000 }),
        listing("fits"),
      ],
      request,
    );
    expect(ranked.map((r) => r.listing.id)).toEqual(["fits", "too-dear"]);
    expect(ranked[0].match.ok).toBe(true);
    expect(ranked[1].match.ok).toBe(false);
  });
});
