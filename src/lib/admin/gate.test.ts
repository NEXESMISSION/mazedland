/**
 * Every console page locks itself.
 *
 * The admin layout redirects whoever is not an admin, but Next renders a
 * layout and its page in parallel, so a page that trusted the layout had
 * already streamed its data by the time the redirect arrived: an anonymous
 * request for /admin/vendeurs came back with sellers' phone numbers
 * (2026-10-24). The proxy now turns those requests away first; this keeps the
 * second lock on every page, including the ones not written yet.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ADMIN = path.join(process.cwd(), "src", "app", "[locale]", "admin");

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

describe("admin pages", () => {
  const all = pages(ADMIN);

  it("are found", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it("each await requireAdmin() before anything else", () => {
    const open = all.filter((file) => {
      const src = fs.readFileSync(file, "utf8");
      const body = src.slice(src.indexOf("export default async function"));
      const open = body.search(/\)(?::\s*[^{\n]+)?\s*\{\r?\n/);
      if (open < 0) return true;
      const firstStatement = body.slice(open).split(/\r?\n/)[1]?.trim();
      return firstStatement !== "await requireAdmin();";
    });
    expect(open.map((f) => path.relative(ADMIN, f))).toEqual([]);
  });
});
