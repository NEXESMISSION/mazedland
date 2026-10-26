import { describe, it, expect } from "vitest";
import { parseLeadPatch, parseNewLead } from "./leads";

describe("parseNewLead", () => {
  it("needs a name; the number, annonce, note and date are optional", () => {
    const r = parseNewLead({ name: "  Sami   Ben Ali ", phone: "98 124 111", note: "Cherche S+2" });
    expect(r).toEqual({
      ok: true,
      value: { name: "Sami Ben Ali", phone: "+21698124111", listing_id: null, note: "Cherche S+2", stage: "new", next_action_at: null },
    });
    expect(parseNewLead({ name: "A" })).toEqual({ ok: false, error: "name" });
  });

  it("refuses a number or a day that is not one", () => {
    expect(parseNewLead({ name: "Sami", phone: "12" })).toEqual({ ok: false, error: "phone" });
    expect(parseNewLead({ name: "Sami", next_action_at: "2026-02-30" })).toEqual({ ok: false, error: "date" });
  });

  it("keeps a valid stage and a next-call day at noon UTC", () => {
    const r = parseNewLead({ name: "Sami", stage: "contacted", next_action_at: "2026-11-02" });
    expect(r.ok && r.value.stage).toBe("contacted");
    expect(r.ok && r.value.next_action_at).toBe("2026-11-02T12:00:00.000Z");
  });
});

describe("parseLeadPatch", () => {
  it("takes only what was sent", () => {
    expect(parseLeadPatch({ stage: "won" })).toEqual({ stage: "won" });
    expect(parseLeadPatch({ note: "" })).toEqual({ note: null });
    expect(parseLeadPatch({ next_action_at: null })).toEqual({ next_action_at: null });
  });

  it("refuses an unknown stage or a bad day, and an empty patch", () => {
    expect(parseLeadPatch({ stage: "hot" })).toBeNull();
    expect(parseLeadPatch({ next_action_at: "demain" })).toBeNull();
    expect(parseLeadPatch({})).toBeNull();
  });
});
