import { describe, it, expect } from "vitest";
import { absoluteUrl, siteUrl } from "./siteUrl";

describe("siteUrl", () => {
  it("prefers the configured domain, without a trailing slash", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://mazed.tn/" })).toBe("https://mazed.tn");
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://mazed.tn",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazed-immo.vercel.app",
      }),
    ).toBe("https://mazed.tn");
  });

  it("uses the stable production hostname on Vercel, never the deployment's own", () => {
    expect(
      siteUrl({
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazed-immo.vercel.app",
        VERCEL_URL: "mazed-immo-3fk2l9x.vercel.app",
      }),
    ).toBe("https://mazed-immo.vercel.app");
  });

  it("ignores a localhost value that reached a Vercel deployment", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazed-immo.vercel.app",
      }),
    ).toBe("https://mazed-immo.vercel.app");
  });

  it("keeps a localhost value off Vercel", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("uses the branch hostname on a preview", () => {
    expect(
      siteUrl({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "mazed-immo-git-fix.vercel.app",
        VERCEL_URL: "mazed-immo-3fk2l9x.vercel.app",
      }),
    ).toBe("https://mazed-immo-git-fix.vercel.app");
  });

  it("returns null rather than inventing a domain", () => {
    expect(siteUrl({})).toBeNull();
    expect(siteUrl({ VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
  });
});

describe("absoluteUrl", () => {
  const env = { NEXT_PUBLIC_SITE_URL: "https://mazed.tn" };

  it("prefixes site paths", () => {
    expect(absoluteUrl("/fr/annonces/1", env)).toBe("https://mazed.tn/fr/annonces/1");
    expect(absoluteUrl("properties/a.webp", env)).toBe("https://mazed.tn/properties/a.webp");
  });

  it("leaves absolute URLs alone", () => {
    expect(absoluteUrl("https://x.supabase.co/a.jpg", env)).toBe("https://x.supabase.co/a.jpg");
  });

  it("leaves the path relative when the origin is unknown", () => {
    expect(absoluteUrl("/fr", {})).toBe("/fr");
  });
});
