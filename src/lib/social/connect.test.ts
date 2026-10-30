import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { callbackUrl, connectDiagnostic, isWantedPage, metaConfig, missingMetaConfig } from "./connect";
import { oauthDialogUrl } from "./meta";

const key = randomBytes(32).toString("base64");

describe("connecting the page", () => {
  it("sends the admin back to the address they started from", () => {
    expect(callbackUrl("http://localhost:3001")).toBe("http://localhost:3001/api/admin/social/meta/callback");
    expect(callbackUrl("https://mazedland.vercel.app/")).toBe("https://mazedland.vercel.app/api/admin/social/meta/callback");
  });

  it("knows the page by its id or its username", () => {
    const page = { id: "1234567890", username: "mazedonline" };
    expect(isWantedPage(page, null)).toBe(true);
    expect(isWantedPage(page, "1234567890")).toBe(true);
    expect(isWantedPage(page, "MazedOnline")).toBe(true);
    expect(isWantedPage({ id: "999", username: "autre" }, "mazedonline")).toBe(false);
  });

  it("reads the settings, and says what is missing", () => {
    expect(metaConfig({ META_APP_ID: "1", META_APP_SECRET: "s" })).toBeNull();
    expect(missingMetaConfig({ META_APP_ID: "1" })).toEqual(["META_APP_SECRET", "SOCIAL_TOKEN_KEY"]);
    expect(metaConfig({ META_APP_ID: "1", META_APP_SECRET: "s", SOCIAL_TOKEN_KEY: key, META_PAGE_ID: "@mazedonline" })).toEqual({
      appId: "1",
      appSecret: "s",
      pageId: "mazedonline",
      loginConfigId: null,
    });
  });

  it("uses a Facebook Login for Business configuration when there is one", () => {
    const withConfig = new URL(oauthDialogUrl({ appId: "A", redirectUri: "https://x/cb", state: "S", configId: "CFG" }));
    expect(withConfig.searchParams.get("config_id")).toBe("CFG");
    expect(withConfig.searchParams.get("scope")).toBeNull();
    const classic = new URL(oauthDialogUrl({ appId: "A", redirectUri: "https://x/cb", state: "S" }));
    expect(classic.searchParams.get("scope")).toContain("pages_manage_posts");
  });

  it("says what Facebook granted and found when the connection brings back no page", () => {
    expect(
      connectDiagnostic({ scopes: ["pages_show_list", "pages_manage_posts"], pageTargets: [], pages: [], wanted: "100057517755322" }),
    ).toBe("permissions : pages_show_list, pages_manage_posts · pages cochées : — · pages trouvées : — · attendue : 100057517755322");
    expect(
      connectDiagnostic({ scopes: [], pageTargets: ["1", "2"], pages: [{ id: "1", name: "Mazed" }], wanted: null }),
    ).toBe("permissions : — · pages cochées : 1, 2 · pages trouvées : Mazed (1) · attendue : toutes");
  });

  it("keeps the diagnostic short enough for a redirect", () => {
    const pages = Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: "Une page avec un nom très long " + i }));
    expect(connectDiagnostic({ scopes: [], pageTargets: [], pages, wanted: "x" }).length).toBeLessThanOrEqual(480);
  });
});
