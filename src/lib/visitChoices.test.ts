import { describe, it, expect } from "vitest";
import fr from "../../messages/fr.json";
import ar from "../../messages/ar.json";
import { parseSlots, VISIT_PARTS, type VisitSlot } from "./visits";
import { addPhrase } from "./phrases";
import {
  BUYER_PHRASES,
  DECLINE_REASONS,
  freePart,
  PART_HOURS,
  partTaken,
  SELLER_NOTE_MAX,
  SELLER_PHRASES,
  suggestSlot,
  VISIT_MESSAGE_MAX,
} from "./visitChoices";

const TODAY = "2026-10-26";
const s = (day: string, part: VisitSlot["part"] = "morning"): VisitSlot => ({ day, part });

describe("partTaken / freePart", () => {
  const slots = [s("2026-10-27"), s("2026-10-28", "afternoon")];

  it("sees a half-day held by another slot, not by the slot itself", () => {
    expect(partTaken(slots, 1, "2026-10-27", "morning")).toBe(true);
    expect(partTaken(slots, 0, "2026-10-27", "morning")).toBe(false);
  });

  it("keeps the slot's time of day when it is free, else the first free one", () => {
    expect(freePart(slots, 1, "2026-10-29", "afternoon")).toBe("afternoon");
    expect(freePart(slots, 1, "2026-10-27", "morning")).toBe("afternoon");
    const full = VISIT_PARTS.map((p) => s("2026-10-30", p));
    expect(freePart([...full, s("2026-10-31")], 3, "2026-10-30", "morning")).toBeNull();
  });
});

describe("suggestSlot", () => {
  it("offers tomorrow morning first, then the day after the last slot at its time of day", () => {
    expect(suggestSlot([], TODAY, 30)).toEqual(s("2026-10-27"));
    expect(suggestSlot([s("2026-10-27", "evening")], TODAY, 30)).toEqual(s("2026-10-28", "evening"));
  });

  it("stays inside the window, going back to the first free half-day", () => {
    expect(suggestSlot([s("2026-10-29")], TODAY, 3)).toEqual(s(TODAY));
    const all = [0, 1, 2, 3].flatMap((i) => VISIT_PARTS.map((p) => s(`2026-10-${26 + i}`, p)));
    expect(suggestSlot(all, TODAY, 3)).toBeNull();
  });

  it("always gives slots the API takes", () => {
    let slots: VisitSlot[] = [];
    for (let i = 0; i < 5; i++) slots = [...slots, suggestSlot(slots, TODAY, 30)!];
    expect(parseSlots(slots, TODAY, { maxSlots: 5, horizonDays: 30 })).toEqual(slots);
  });
});

describe("PART_HOURS", () => {
  it("names hours inside their half-day, in order", () => {
    for (const p of VISIT_PARTS) {
      const h = PART_HOURS[p];
      expect(h.length).toBeGreaterThan(0);
      expect([...h].sort((a, b) => a - b)).toEqual(h);
    }
    expect(Math.max(...PART_HOURS.morning)).toBeLessThan(Math.min(...PART_HOURS.afternoon));
    expect(Math.max(...PART_HOURS.afternoon)).toBeLessThan(Math.min(...PART_HOURS.evening));
  });
});

describe("the default messages", () => {
  for (const [lang, m] of [["fr", fr], ["ar", ar]] as const) {
    const v = m.visits;
    const fill = (base: string, phrases: string[]) => phrases.reduce((t, p) => addPhrase(t, p), base);

    it(`${lang}: the buyer's message, with every chip, fits the field`, () => {
      expect(v.request.defaultMessage.trim()).not.toBe("");
      const phrases = BUYER_PHRASES.map((k) => v.request.phrases[k]);
      const all = fill(v.request.defaultMessage, phrases);
      expect(all.length).toBeLessThanOrEqual(VISIT_MESSAGE_MAX);
      for (const p of phrases) expect(all).toContain(p);
    });

    it(`${lang}: the seller's word, with an hour, every phrase and a reason, fits the field`, () => {
      expect(v.actions.defaultNote.trim()).not.toBe("");
      const hour = v.actions.hourPhrase.replace("{hour}", "17");
      const yes = fill(v.actions.defaultNote, [hour, ...SELLER_PHRASES.map((k) => v.actions.phrases[k])]);
      expect(yes.length).toBeLessThanOrEqual(SELLER_NOTE_MAX);
      const propose = v.actions.proposePhrase.replace("{day}", "mercredi 28 octobre").replace("{part}", v.parts.evening);
      for (const r of DECLINE_REASONS) {
        expect(fill(v.actions.declineReasons[r], [propose]).length).toBeLessThanOrEqual(SELLER_NOTE_MAX);
      }
    });
  }
});
