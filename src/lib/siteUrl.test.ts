import { describe, it, expect } from "vitest";
import { absoluteUrl, PRODUCTION_ORIGIN, siteUrl } from "./siteUrl";

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

  it("uses the project's custom production domain on Vercel, never the deployment's own", () => {
    expect(
      siteUrl({
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazed.immo",
        VERCEL_URL: "mazed-immo-3fk2l9x.vercel.app",
      }),
    ).toBe("https://mazed.immo");
  });

  it("never sends production links to a vercel.app host", () => {
    expect(
      siteUrl({
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazedland.vercel.app",
        VERCEL_URL: "mazedland-3fk2l9x.vercel.app",
      }),
    ).toBe(PRODUCTION_ORIGIN);
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://mazedland.vercel.app",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazedland.vercel.app",
      }),
    ).toBe(PRODUCTION_ORIGIN);
    expect(PRODUCTION_ORIGIN).toBe("https://www.mazed.immo");
  });

  it("ignores a localhost value that reached a Vercel deployment", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "mazed-immo.vercel.app",
      }),
    ).toBe(PRODUCTION_ORIGIN);
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

  it("returns null off Vercel rather than inventing a domain, and the real one in production", () => {
    expect(siteUrl({})).toBeNull();
    expect(siteUrl({ VERCEL: "1", VERCEL_ENV: "preview" })).toBeNull();
    expect(siteUrl({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(PRODUCTION_ORIGIN);
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
