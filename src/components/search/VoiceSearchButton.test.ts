import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { speechLang } from "./VoiceSearchButton";
import { SETTINGS } from "@/lib/settings/registry";

describe("voice search", () => {
  it("listens in the page's language, Tunisian Arabic on /ar", () => {
    expect(speechLang("ar")).toBe("ar-TN");
    expect(speechLang("fr")).toBe("fr-FR");
  });

  it("can be switched off from the console, and the browser hears the switch", () => {
    expect(SETTINGS.feature_voice_search).toMatchObject({ type: "bool", default: true, client: true });
  });

  it("sits in every public search box", () => {
    for (const f of ["src/app/[locale]/annonces/page.tsx", "src/components/layout/DesktopNav.tsx", "src/components/landing/HomeSearch.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const boxes = (src.match(/type="search"/g) ?? []).length;
      const mics = (src.match(/<VoiceSearchButton\b/g) ?? []).length;
      expect(mics, f).toBe(boxes);
    }
  });
});
