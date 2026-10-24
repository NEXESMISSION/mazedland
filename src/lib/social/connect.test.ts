import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { callbackUrl, isWantedPage, metaConfig, missingMetaConfig } from "./connect";
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
});
