import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTATION_LANGS, asDictationLang, transcriptOf, withDictation } from "./speech";
import { SETTINGS } from "@/lib/settings/registry";
import { buildSystemPrompt } from "@/lib/ai/listing";

const result = (...said: string[]) => said.map((s) => Object.assign([{ transcript: s }], { isFinal: true }));

describe("listing dictation", () => {
  it("listens in Tunisian Arabic, French or English, nothing else", () => {
    expect(DICTATION_LANGS).toEqual(["ar-TN", "fr-FR", "en-US"]);
    expect(asDictationLang("en-US")).toBe("en-US");
    expect(asDictationLang("de-DE")).toBeNull();
    expect(asDictationLang(null)).toBeNull();
  });

  it("joins what was heard into one line", () => {
    expect(transcriptOf(result("دار في صفاقس ", "  180 متر"))).toBe("دار في صفاقس 180 متر");
    expect(transcriptOf([])).toBe("");
  });

  it("adds the spoken words after what was typed, within the box's limit", () => {
    expect(withDictation("", "maison à Sfax", 800)).toBe("maison à Sfax");
    expect(withDictation("Villa à Hammamet ", "avec piscine", 800)).toBe("Villa à Hammamet avec piscine");
    expect(withDictation("déjà écrit", "", 800)).toBe("déjà écrit");
    expect(withDictation("abc", "defgh", 6)).toBe("abc de");
  });

  it("can be switched off from the console, and the browser hears the switch", () => {
    expect(SETTINGS.feature_ai_voice).toMatchObject({ type: "bool", default: true, client: true });
  });

  it("sits in the assistant's box of the publish form", () => {
    const src = readFileSync(join(process.cwd(), "src/app/[locale]/annonces/nouvelle/PublishWizard.tsx"), "utf8");
    expect(src).toMatch(/<ListingDictation\b[^>]*value=\{aiText\}/);
  });

  it("tells the assistant that the text may be dictated, and in English", () => {
    const p = buildSystemPrompt([]);
    expect(p).toContain("dictated by voice");
    expect(p).toContain("English");
    expect(p).toContain("write the title and the description in French");
  });
});
