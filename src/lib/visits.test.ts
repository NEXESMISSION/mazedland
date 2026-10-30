import { describe, it, expect } from "vitest";
import { nextStatus, parseSlots, personName, pickSlot, stageAfterVisit, tunisDay } from "./visits";

const TODAY = "2026-10-26";

describe("personName", () => {
  it("keeps a name, in any script, with its spaces collapsed", () => {
    expect(personName("  Mohamed   Ali Ben Salah ")).toBe("Mohamed Ali Ben Salah");
    expect(personName("Jean-Pierre O'Neil")).toBe("Jean-Pierre O'Neil");
    expect(personName("محمد بن علي")).toBe("محمد بن علي");
    expect(personName("Mme K.")).toBe("Mme K.");
  });

  it("refuses what is not a name: numbers, symbols, a message, the empty, the endless", () => {
    // The name reaches the seller under the platform's name, so a phone
    // number or an instruction in it is refused, not relayed.
    expect(personName("Appelez le 20123456 urgent")).toBeNull();
    expect(personName("Karim (agence)")).toBeNull();
    expect(personName("http://evil.example")).toBeNull();
    expect(personName("K")).toBeNull();
    expect(personName("---")).toBeNull();
    expect(personName("a".repeat(61))).toBeNull();
    expect(personName(42)).toBeNull();
    expect(personName(undefined)).toBeNull();
  });
});

describe("parseSlots", () => {
  it("keeps one to three distinct half-days in the next 30 days", () => {
    expect(parseSlots([{ day: "2026-10-27", part: "morning" }], TODAY)).toEqual([{ day: "2026-10-27", part: "morning" }]);
    expect(
      parseSlots(
        [
          { day: TODAY, part: "evening" },
          { day: "2026-10-27", part: "afternoon" },
          { day: "2026-11-25", part: "morning" },
        ],
        TODAY,
      ),
    ).toHaveLength(3);
  });

  it("refuses none, four, duplicates, the past, beyond 30 days, non-days and unknown parts", () => {
    expect(parseSlots([], TODAY)).toBeNull();
    expect(parseSlots("x", TODAY)).toBeNull();
    const d = (day: string, part = "morning") => ({ day, part });
    expect(parseSlots([d("2026-10-27"), d("2026-10-28"), d("2026-10-29"), d("2026-10-30")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-10-27"), d("2026-10-27")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-10-25")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-11-26")], TODAY)).toBeNull();
    expect(parseSlots([d("2026-02-30")], "2026-02-01")).toBeNull();
    expect(parseSlots([d("2026-10-27", "night")], TODAY)).toBeNull();
  });

  it("follows the console's number of slots and horizon", () => {
    const d = (day: string, part = "morning") => ({ day, part });
    const five = [d("2026-10-27"), d("2026-10-28"), d("2026-10-29"), d("2026-10-30"), d("2026-10-31")];
    expect(parseSlots(five, TODAY, { maxSlots: 5, horizonDays: 30 })).toHaveLength(5);
    expect(parseSlots(five.slice(0, 2), TODAY, { maxSlots: 1, horizonDays: 30 })).toBeNull();
    expect(parseSlots([d("2026-10-29")], TODAY, { maxSlots: 3, horizonDays: 3 })).toHaveLength(1);
    expect(parseSlots([d("2026-10-30")], TODAY, { maxSlots: 3, horizonDays: 3 })).toBeNull();
    expect(parseSlots([d("2027-01-24")], TODAY, { maxSlots: 3, horizonDays: 90 })).toHaveLength(1);
    expect(parseSlots([d("2027-01-25")], TODAY, { maxSlots: 3, horizonDays: 90 })).toBeNull();
  });
});

describe("nextStatus", () => {
  it("lets the seller confirm, decline, then close", () => {
    expect(nextStatus("requested", "confirm", "seller")).toBe("confirmed");
    expect(nextStatus("requested", "decline", "seller")).toBe("declined");
    expect(nextStatus("confirmed", "done", "seller")).toBe("done");
    expect(nextStatus("confirmed", "cancel", "seller")).toBe("cancelled");
    expect(nextStatus("requested", "done", "seller")).toBeNull();
    expect(nextStatus("declined", "confirm", "seller")).toBeNull();
  });

  it("lets the buyer only cancel an open request", () => {
    expect(nextStatus("requested", "cancel", "buyer")).toBe("cancelled");
    expect(nextStatus("confirmed", "cancel", "buyer")).toBe("cancelled");
    expect(nextStatus("requested", "confirm", "buyer")).toBeNull();
    expect(nextStatus("done", "cancel", "buyer")).toBeNull();
  });
});

describe("pickSlot and the pipeline", () => {
  it("confirms only a slot the buyer proposed", () => {
    const slots = [{ day: "2026-10-27", part: "morning" as const }];
    expect(pickSlot(slots, { day: "2026-10-27", part: "morning" })).toEqual(slots[0]);
    expect(pickSlot(slots, { day: "2026-10-27", part: "evening" })).toBeNull();
  });

  it("moves a client to « visite » once a visit is set, never back from a later stage", () => {
    expect(stageAfterVisit("new", "confirmed")).toBe("visit");
    expect(stageAfterVisit("contacted", "done")).toBe("visit");
    expect(stageAfterVisit("negotiation", "confirmed")).toBe("negotiation");
    expect(stageAfterVisit("new", "declined")).toBe("new");
  });

  it("reads today in Tunisia", () => {
    expect(tunisDay(new Date("2026-10-26T23:30:00Z"))).toBe("2026-10-27");
  });
});
