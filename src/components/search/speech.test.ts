import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTATION_LANGS, asDictationLang, transcriptOf } from "./speech";
import { SETTINGS } from "@/lib/settings/registry";
import { buildSystemPrompt } from "@/lib/ai/listing";

const result = (...said: string[]) => said.map((s) => Object.assign([{ transcript: s }], { isFinal: true }));

describe("dictation", () => {
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

  it("can be switched off from the console, and the browser hears the switch", () => {
    expect(SETTINGS.feature_ai_voice).toMatchObject({ type: "bool", default: true, client: true });
  });

  it("lives in « Publier en parlant », not in the form", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    expect(read("src/app/[locale]/annonces/nouvelle/parler/ChatPublisher.tsx")).toContain("useDictation(");
    expect(read("src/app/[locale]/annonces/nouvelle/PublishWizard.tsx")).not.toMatch(/useDictation|DictationLangPicker|ListingDictation/);
  });

  it("tells the assistant that the text may be dictated, and in English", () => {
    const p = buildSystemPrompt([]);
    expect(p).toContain("dictated by voice");
    expect(p).toContain("English");
    expect(p).toContain("write the title and the description in French");
  });
});
