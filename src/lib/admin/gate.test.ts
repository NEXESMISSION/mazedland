/**
 * Every console page locks itself.
 *
 * The admin layout redirects whoever is not an admin, but Next renders a
 * layout and its page in parallel, so a page that trusted the layout had
 * already streamed its data by the time the redirect arrived: an anonymous
 * request for /admin/vendeurs came back with sellers' phone numbers
 * (2026-10-24). The proxy now turns those requests away first; this keeps the
 * second lock on every page, including the ones not written yet.
 *
 * Since the console has a team (0178), the lock also names the page's section
 * — the folder it lives in — so a moderator cannot open the payments by URL.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isAdminSection, isOwnerSection } from "./sections";

const ADMIN = path.join(process.cwd(), "src", "app", "[locale]", "admin");

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

/** `await requireAdmin()` or `await requireAdmin("section")`, its result kept or not. */
const GATE = /^(?:const \{[^}]*\} = )?await requireAdmin\((?:"([a-z-]+)")?\);$/;

function firstStatement(file: string): string | undefined {
  const src = fs.readFileSync(file, "utf8");
  const body = src.slice(src.indexOf("export default async function"));
  const open = body.search(/\)(?::\s*[^{\n]+)?\s*\{\r?\n/);
  if (open < 0) return undefined;
  return body.slice(open).split(/\r?\n/)[1]?.trim();
}

describe("admin pages", () => {
  const all = pages(ADMIN);

  it("are found", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it("each await requireAdmin() before anything else", () => {
    const open = all.filter((file) => !GATE.test(firstStatement(file) ?? ""));
    expect(open.map((f) => path.relative(ADMIN, f))).toEqual([]);
  });

  it("each name the section of the folder they are in", () => {
    const wrong = all.filter((file) => {
      const folder = path.relative(ADMIN, file).split(path.sep)[0];
      const named = GATE.exec(firstStatement(file) ?? "")?.[1];
      const isSection = isAdminSection(folder) || isOwnerSection(folder);
      return isSection ? named !== folder : named !== undefined;
    });
    expect(wrong.map((f) => path.relative(ADMIN, f))).toEqual([]);
  });
});

const API = path.join(process.cwd(), "src", "app", "api", "admin");

/** API folders named otherwise than the screen they serve. */
const API_SECTION: Record<string, string> = { ads: "publicites", backup: "settings", boutiques: "agences", products: "offres" };

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routes(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

describe("admin API routes", () => {
  it("each check the section of the screen they serve", () => {
    const wrong = routes(API).filter((file) => {
      const src = fs.readFileSync(file, "utf8");
      const folder = path.relative(API, file).split(path.sep)[0];
      const section = API_SECTION[folder] ?? folder;
      // One door for actions of different sections (a table of them), or
      // its own gate naming the section.
      return !(
        src.includes(`requireAdmin(req, "${section}")`) ||
        src.includes("ACTION_SECTION") ||
        src.includes(`canOpen(scopesFromRow(profile.admin_scopes), "${section}")`) ||
        src.includes(`canOpen(scopes, "${section}")`)
      );
    });
    expect(wrong.map((f) => path.relative(API, f))).toEqual([]);
  });
});
