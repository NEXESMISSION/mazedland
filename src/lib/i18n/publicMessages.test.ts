import { describe, it, expect } from "vitest";
import fr from "../../../messages/fr.json";
import { CONSOLE_ONLY, publicMessages } from "./publicMessages";

describe("the texts a public page carries", () => {
  it("leave out the console's namespaces, and only them", () => {
    const kept = Object.keys(publicMessages(fr));
    expect(kept).toContain("publish");
    expect(kept).toContain("apiErrors");
    expect(kept).toContain("nav");
    expect(kept).not.toContain("admin");
    expect(kept).not.toContain("adminListings");
    expect(kept).not.toContain("settingsRegistry");
    expect(CONSOLE_ONLY.test("administration")).toBe(false);
  });

  it("are well under the whole set", () => {
    const all = JSON.stringify(fr).length;
    expect(JSON.stringify(publicMessages(fr)).length).toBeLessThan(all * 0.75);
  });
});
