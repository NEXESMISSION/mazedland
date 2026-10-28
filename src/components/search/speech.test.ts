import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { speechLang, transcriptOf } from "./speech";
import { SETTINGS } from "@/lib/settings/registry";
import { buildSystemPrompt } from "@/lib/ai/listing";

const result = (...said: string[]) => said.map((s) => Object.assign([{ transcript: s }], { isFinal: true }));
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("dictation", () => {
  it("listens in the page's language, with no language to pick", () => {
    expect(speechLang("ar")).toBe("ar-TN");
    expect(speechLang("fr")).toBe("fr-FR");
    const chat = read("src/app/[locale]/annonces/nouvelle/parler/ChatPublisher.tsx");
    expect(chat).toContain("speechLang(locale)");
    expect(chat).not.toMatch(/DictationLangPicker|en-US/);
  });

  it("joins what was heard into one line", () => {
    expect(transcriptOf(result("دار في صفاقس ", "  180 متر"))).toBe("دار في صفاقس 180 متر");
    expect(transcriptOf([])).toBe("");
  });

  it("can be switched off from the console, and the browser hears the switch", () => {
    expect(SETTINGS.feature_ai_voice).toMatchObject({ type: "bool", default: true, client: true });
  });

  it("lives in « Publier en parlant », not in the form", () => {
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
