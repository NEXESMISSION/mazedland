import { describe, it, expect } from "vitest";
import { nextStatus, parseSlots, pickSlot, stageAfterVisit, tunisDay } from "./visits";

const TODAY = "2026-10-26";

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
