/**
 * What the proxy's matcher lets through unseen.
 *
 * The matcher is a literal Next reads at build time, so it is read here from
 * the file, as Next would, and tried the way path-to-regexp applies it. It
 * used to skip every path with a dot in it as « a static file », so the
 * console and account gates never ran for /fr/admin/popups/a.b/edit: an
 * anonymous request got the page shell with the layout's late redirect
 * inside it (the QA tour, 2026-10-30). Only a real asset extension is skipped.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
const literal = /matcher:\s*\["((?:[^"\\]|\\.)*)"\]/.exec(src)?.[1];
// The string as JavaScript reads it (one backslash less), then the one
// unnamed parameter path-to-regexp turns it into, anchored like Next does.
const pattern = JSON.parse(`"${literal}"`) as string;
const inner = pattern.slice(pattern.indexOf("(") + 1, pattern.lastIndexOf(")"));
const matcher = new RegExp(`^/(${inner})/?$`);

const runs = (p: string) => matcher.test(p);

describe("the proxy matcher", () => {
  it("is read from the file", () => {
    expect(literal).toBeTruthy();
  });

  it("runs the gates on every page, dotted segment or not", () => {
    for (const p of [
      "/fr",
      "/fr/admin/vendeurs",
      "/fr/admin/popups/a.b/edit",
      "/ar/admin/popups/%61.b/edit",
      "/fr/account/listings/a.b/mise-en-avant",
      "/fr/factures/a.b",
      "/fr/agences/agence.immo",
      "/fr/annonces?q=1.5",
      "/en/account",
    ]) expect(runs(p), p).toBe(true);
  });

  it("skips Next internals, the API and real static files", () => {
    for (const p of [
      "/api/annonces",
      "/api/cron/prune-uploads",
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/_vercel/insights/script.js",
      "/favicon.ico",
      "/logo.png",
      "/og.png",
      "/auth-hero.w640.webp",
      "/icons/apartment.avif",
      "/sw.js",
      "/manifest.webmanifest",
      "/admin.webmanifest",
      "/robots.txt",
      "/sitemap.xml",
      "/models/face-api/tiny_face_detector_model.bin",
      "/models/face-api/tiny_face_detector_model-weights_manifest.json",
      "/fonts/Inter.woff2",
    ]) expect(runs(p), p).toBe(false);
  });
});
