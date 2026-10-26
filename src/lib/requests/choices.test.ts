import { describe, it, expect } from "vitest";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { addPhrase } from "@/lib/phrases";
import { NOTE_MAX } from "./prefill";
import { parseRequestInput } from "./model";
import {
  governorateChips,
  NOTE_PHRASES,
  presetChoice,
  QUICK_GOVERNORATES,
  ROOMS_PRESETS,
  SURFACE_PRESETS,
  withCurrent,
} from "./choices";

describe("presetChoice", () => {
  it("is the preset, « Autre » for any other number, nothing when empty", () => {
    expect(presetChoice("80", SURFACE_PRESETS)).toBe(80);
    expect(presetChoice("90", SURFACE_PRESETS)).toBe("other");
    expect(presetChoice("", SURFACE_PRESETS)).toBeNull();
    expect(presetChoice("0", SURFACE_PRESETS)).toBeNull();
  });
});

describe("withCurrent", () => {
  it("adds a value that is not a chip, in its place, so it stays visible", () => {
    expect(withCurrent(ROOMS_PRESETS, "7")).toEqual([1, 2, 3, 4, 5, 7]);
    expect(withCurrent(ROOMS_PRESETS, "3")).toEqual([1, 2, 3, 4, 5]);
    expect(withCurrent(ROOMS_PRESETS, "")).toEqual([1, 2, 3, 4, 5]);
  });

  it("offers only rooms the API keeps", () => {
    for (const n of ROOMS_PRESETS) {
      const r = parseRequestInput({ budget_max: 1000, rooms_min: n });
      expect(r.ok && r.value.rooms_min).toBe(n);
    }
  });
});

describe("governorateChips", () => {
  it("are real governorates", () => {
    for (const g of QUICK_GOVERNORATES) expect(TUNISIAN_GOVERNORATES).toContain(g);
  });

  it("show the quick ones, then any other already chosen", () => {
    expect(governorateChips([])).toEqual(QUICK_GOVERNORATES);
    expect(governorateChips(["Tozeur", "Tunis", "Bizerte"])).toEqual([...QUICK_GOVERNORATES, "Bizerte", "Tozeur"]);
  });
});

describe("the note's phrases", () => {
  for (const [lang, m] of [["fr", fr], ["ar", ar]] as const) {
    it(`${lang}: all of them fit « Autres souhaits »`, () => {
      const all = NOTE_PHRASES.reduce((t, k) => addPhrase(t, m.requests.notePhrases[k]), "");
      expect(all.length).toBeLessThanOrEqual(NOTE_MAX);
      for (const k of NOTE_PHRASES) expect(all).toContain(m.requests.notePhrases[k]);
    });
  }
});
