import { describe, expect, it } from "vitest";
import { PLACE_STATUSES, holdsPlace, placeFor, placesLeft, roomiest } from "./model";

describe("holdsPlace", () => {
  it("counts annonces online or waiting for a moderator", () => {
    expect(PLACE_STATUSES).toEqual(["published", "pending_review"]);
    expect(holdsPlace("published")).toBe(true);
    expect(holdsPlace("pending_review")).toBe(true);
  });

  it("does not count drafts, withdrawn, expired, refused, sold or rented annonces", () => {
    for (const s of ["draft", "archived", "expired", "rejected", "sold", "rented", "pending_payment", null, undefined]) {
      expect(holdsPlace(s)).toBe(false);
    }
  });
});

describe("placesLeft", () => {
  it("is what remains of the limit, never below zero", () => {
    expect(placesLeft(2, 10)).toBe(8);
    expect(placesLeft(12, 10)).toBe(0);
  });
});

describe("placeFor", () => {
  const base = { forShop: false, shopPlanHasRoom: false, ownedPlan: null, accountUsed: 0, freeLimit: 2 };

  it("gives an account without a plan its free places, then asks for a credit", () => {
    expect(placeFor({ ...base, accountUsed: 1 })).toBe("free_quota");
    expect(placeFor({ ...base, accountUsed: 2 })).toBe("credit");
  });

  it("two personal annonces, then a plan of ten: the plan covers eight more, then a credit", () => {
    // Before: the two free places are taken.
    expect(placeFor({ ...base, accountUsed: 2 })).toBe("credit");
    // After the upgrade the two count in the plan: 2/10, so the 3rd to the
    // 10th go online under it, for the agence or as their own…
    for (let used = 2; used < 10; used++) {
      expect(placeFor({ ...base, ownedPlan: { used, quota: 10 } })).toBe("own_plan");
      expect(placeFor({ ...base, forShop: true, shopPlanHasRoom: true, ownedPlan: { used, quota: 10 } })).toBe("shop_plan");
    }
    // …and the 11th does not.
    expect(placeFor({ ...base, ownedPlan: { used: 10, quota: 10 } })).toBe("credit");
    expect(placeFor({ ...base, forShop: true, ownedPlan: { used: 10, quota: 10 } })).toBe("credit");
  });

  it("never adds the free places on top of an owner's plan", () => {
    // A full plan, an account that would still be under its free limit on its own.
    expect(placeFor({ ...base, ownedPlan: { used: 10, quota: 10 }, accountUsed: 0 })).toBe("credit");
  });

  it("lets an agent with no plan of their own use their free places when the agence is full", () => {
    expect(placeFor({ ...base, forShop: true, shopPlanHasRoom: false, accountUsed: 1 })).toBe("free_quota");
  });
});

describe("roomiest", () => {
  it("picks the plan with the most places left", () => {
    const a = { id: "a", used: 9, quota: 10 };
    const b = { id: "b", used: 5, quota: 40 };
    expect(roomiest([a, b])?.id).toBe("b");
    expect(roomiest([])).toBeNull();
  });
});
