/**
 * One count of places for the whole site.
 *
 * The plan of an agence and the free places were counted in two separate
 * ways, so an owner with two annonces who took a plan of ten read « 0 / 10 »
 * on the dashboard while « Mes annonces » listed the two (2026-10-27). Every
 * route that puts an annonce online, and every screen that shows the count,
 * now goes through src/lib/places; this keeps it that way.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const ROUTES = [
  "src/app/api/annonces/[id]/submit/route.ts",
  "src/app/api/annonces/[id]/renew/route.ts",
  "src/app/api/annonces/[id]/status/route.ts",
];

const SCREENS = [
  "src/app/[locale]/account/listings/page.tsx",
  "src/app/[locale]/annonces/nouvelle/page.tsx",
  "src/app/[locale]/pro/dashboard/page.tsx",
  "src/app/[locale]/admin/agences/page.tsx",
];

describe("places", () => {
  it("are decided by coverPlace in every route that puts an annonce online", () => {
    for (const file of ROUTES) {
      const src = read(file);
      expect(src, file).toContain("coverPlace(");
      // Credits are spent inside coverPlace, once, in its order.
      expect(src, file).not.toContain("consume_listing_credit");
    }
  });

  it("are counted by src/lib/places on every screen that shows them", () => {
    for (const file of SCREENS) {
      expect(read(file), file).toMatch(/from "@\/lib\/places\/server"/);
    }
  });

  it("are not counted by hand anywhere else", () => {
    // The statuses that hold a place, written out instead of PLACE_STATUSES.
    const inline = /\[\s*"(?:published|pending_review)",\s*"(?:published|pending_review)"\s*\]/;
    for (const file of [...ROUTES, ...SCREENS, "src/lib/moderation/server.ts", "src/lib/pro/shops.ts"]) {
      const src = read(file);
      const hits = src.split("\n").filter((line) => inline.test(line) && !line.includes("isEditable") && !line.includes("wantedEdit"));
      expect(hits, file).toEqual([]);
    }
  });
});
