import { describe, it, expect } from "vitest";
import {
  appliesTo,
  asDealType,
  closedStatus,
  firstMonthCost,
  isoDay,
  parseRentFacts,
} from "./deal";

describe("asDealType", () => {
  it("reads only an explicit rental as one", () => {
    expect(asDealType("rent")).toBe("rent");
    expect(asDealType("sale")).toBe("sale");
    expect(asDealType(undefined)).toBe("sale");
    expect(asDealType("RENT")).toBe("sale");
  });

  it("closes a rental as let and a sale as sold", () => {
    expect(closedStatus("rent")).toBe("rented");
    expect(closedStatus("sale")).toBe("sold");
  });
});

describe("parseRentFacts", () => {
  it("keeps what the owner said and drops what is malformed", () => {
    expect(
      parseRentFacts({
        deposit_amount: "2400",
        charges_amount: 0,
        furnished: "furnished",
        available_from: "2026-12-01",
        min_lease_months: "12",
      }),
    ).toEqual({
      deposit_amount: 2400,
      charges_amount: 0,
      furnished: "furnished",
      available_from: "2026-12-01",
      min_lease_months: 12,
    });
    expect(
      parseRentFacts({
        deposit_amount: "-5",
        charges_amount: "",
        furnished: "yes",
        available_from: "2026-02-30",
        min_lease_months: 0,
      }),
    ).toEqual({
      deposit_amount: null,
      charges_amount: null,
      furnished: null,
      available_from: null,
      min_lease_months: null,
    });
  });

  it("accepts only real calendar days", () => {
    expect(isoDay("2026-02-28")).toBe("2026-02-28");
    expect(isoDay("2026-02-29")).toBeNull();
    expect(isoDay("01/12/2026")).toBeNull();
  });
});

describe("firstMonthCost", () => {
  it("adds rent, deposit and charges", () => {
    expect(firstMonthCost({ price: 1200, deposit: 2400, charges: 50 })).toBe(3650);
    expect(firstMonthCost({ price: 800, deposit: 800, charges: 0 })).toBe(1600);
  });

  it("says nothing rather than an understated total", () => {
    expect(firstMonthCost({ price: 1200, deposit: null, charges: 50 })).toBeNull();
    expect(firstMonthCost({ price: 1200, deposit: 2400, charges: null })).toBeNull();
    expect(firstMonthCost({ price: null, priceOnRequest: true, deposit: 0, charges: 0 })).toBeNull();
  });
});

describe("appliesTo", () => {
  it("asks a question for both deals unless it is limited", () => {
    expect(appliesTo(null, "rent")).toBe(true);
    expect(appliesTo([], "sale")).toBe(true);
    expect(appliesTo(["sale"], "rent")).toBe(false);
    expect(appliesTo(["sale"], "sale")).toBe(true);
  });
});
