import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { HomeListingRow } from "./feed";
import { SETTINGS } from "@/lib/settings/registry";
import { settingsFromRows } from "@/lib/settings/server";
import {
  DEFAULT_RAIL_OPTIONS,
  HOME_RAIL_KEYS,
  HOME_TYPE_RAILS,
  MIN_RAIL_CARDS,
  RAIL_SETTING,
  homeRailOptions,
  isOnHome,
  planHomeRails,
  splitAtMiddle,
  type HomeRailsInput,
} from "./rails";

const NOW = Date.parse("2026-10-27T12:00:00Z");

function row(id: string, extra: Partial<HomeListingRow> = {}): HomeListingRow {
  return {
    id,
    title: `Annonce ${id}`,
    price: 100_000,
    price_on_request: false,
    negotiable: false,
    governorate: "tunis",
    delegation: null,
    reference: null,
    attributes: null,
    published_at: "2026-10-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    category: null,
    photos: null,
    deal_type: "sale",
    availability: null,
    ...extra,
  };
}
const rows = (prefix: string, n: number, extra: Partial<HomeListingRow> = {}) =>
  Array.from({ length: n }, (_, i) => row(`${prefix}${i + 1}`, extra));
/** Every rail on, default size, at NOW. */
const plan = (feed: HomeRailsInput | null) => planHomeRails(feed, DEFAULT_RAIL_OPTIONS, NOW);
const keys = (p: ReturnType<typeof planHomeRails>) => p.rails.map((r) => r.key);
const ids = (p: ReturnType<typeof planHomeRails>, key: string) =>
  p.rails.find((r) => r.key === key)?.rows.map((r) => r.id);

/** A feed with enough annonces for every rail. */
const fullFeed: HomeRailsInput = {
  published: { rows: rows("p", 3, { promo_home_featured: true }) },
  mostViewed: rows("v", 4),
  nouveautes: rows("n", 4),
  rentals: rows("r", 4),
  bestValue: rows("b", 4),
  byType: Object.fromEntries(HOME_TYPE_RAILS.map((slug) => [slug, rows(slug, 3)])),
};

describe("isOnHome", () => {
  it("is a running home placement or banner", () => {
    expect(isOnHome(row("a", { promo_home_featured: true }), NOW)).toBe(true);
    expect(isOnHome(row("a", { promo_banner: true }), NOW)).toBe(true);
    expect(isOnHome(row("a"), NOW)).toBe(false);
  });

  it("leaves out a placement whose period has ended, before the expiry job clears it", () => {
    expect(isOnHome(row("a", { promo_home_featured: true, promo_expires_at: "2026-10-27T11:59:00Z" }), NOW)).toBe(false);
    expect(isOnHome(row("a", { promo_home_featured: true, promo_expires_at: "2026-10-28T00:00:00Z" }), NOW)).toBe(true);
  });
});

describe("planHomeRails", () => {
  it("shows nothing for an empty or missing feed", () => {
    expect(plan(null)).toEqual({ rails: [], explore: null });
    expect(plan({})).toEqual({ rails: [], explore: null });
  });

  it("puts the rails in page order, « À la une » first", () => {
    const p = plan(fullFeed);
    expect(keys(p)).toEqual(["featured", "mostViewed", "nouveautes", "rent", "bestValue", ...HOME_TYPE_RAILS]);
    expect(p.rails[0].sponsored).toBe(true);
  });

  it("hides a rail with fewer than three annonces", () => {
    expect(MIN_RAIL_CARDS).toBe(3);
    const p = plan({ mostViewed: rows("v", 2), rentals: rows("r", 3), byType: { terrain: rows("t", 2), villas: rows("w", 5) } });
    expect(keys(p)).toEqual(["rent", "villas"]);
  });

  it("builds « À la une » from the published slice: paid home placements only", () => {
    const published = [
      row("banner", { promo_banner: true }),
      row("home", { promo_home_featured: true }),
      row("ended", { promo_home_featured: true, promo_expires_at: "2026-10-01T00:00:00Z" }),
      row("home2", { promo_home_featured: true }),
      row("plain"),
    ];
    expect(ids(plan({ published: { rows: published } }), "featured")).toEqual(["banner", "home", "home2"]);
  });

  it("takes out of « Les plus vus » and « Nouveautés » what an earlier rail shows", () => {
    const featured = rows("f", 3, { promo_home_featured: true });
    const p = plan({
      published: { rows: featured },
      mostViewed: [featured[0], ...rows("v", 3)],
      nouveautes: [featured[1], row("v1"), ...rows("n", 3)],
    });
    expect(ids(p, "mostViewed")).toEqual(["v1", "v2", "v3"]);
    expect(ids(p, "nouveautes")).toEqual(["n1", "n2", "n3"]);
  });

  it("does not let a hidden rail take annonces from a later one", () => {
    // Two promoted annonces are not a rail, so « Les plus vus » keeps them.
    const featured = rows("f", 2, { promo_home_featured: true });
    const p = plan({ published: { rows: featured }, mostViewed: [...featured, row("v1")] });
    expect(keys(p)).toEqual(["mostViewed"]);
    expect(ids(p, "mostViewed")).toEqual(["f1", "f2", "v1"]);
  });

  it("lets the rails that cut by a criterion keep annonces shown above", () => {
    const shared = rows("s", 3, { deal_type: "rent" });
    const p = plan({ mostViewed: shared, rentals: shared, bestValue: shared, byType: { appartements: shared } });
    expect(keys(p)).toEqual(["mostViewed", "rent", "bestValue", "appartements"]);
  });

  it("holds as many cards as the console asks", () => {
    expect(plan({ rentals: rows("r", 20) }).rails[0].rows).toHaveLength(DEFAULT_RAIL_OPTIONS.size);
    const p = planHomeRails({ rentals: rows("r", 20) }, { ...DEFAULT_RAIL_OPTIONS, size: 5 }, NOW);
    expect(p.rails[0].rows).toHaveLength(5);
  });

  it("leaves out the rails the console switched off, and lets the next keep their annonces", () => {
    const featured = rows("f", 3, { promo_home_featured: true });
    const options = { ...DEFAULT_RAIL_OPTIONS, enabled: DEFAULT_RAIL_OPTIONS.enabled.filter((k) => k !== "featured" && k !== "villas") };
    const p = planHomeRails({ ...fullFeed, published: { rows: featured }, mostViewed: featured }, options, NOW);
    expect(keys(p)).not.toContain("featured");
    expect(keys(p)).not.toContain("villas");
    // « À la une » is off, so its annonces are not taken out of « Les plus vus ».
    expect(ids(p, "mostViewed")).toEqual(["f1", "f2", "f3"]);
  });

  it("links « Tout voir » to the matching catalogue search", () => {
    const p = plan({ rentals: rows("r", 3), bestValue: rows("b", 3), byType: { terrain: rows("t", 3), villas: rows("w", 3) } });
    expect(Object.fromEntries(p.rails.map((r) => [r.key, r.href]))).toEqual({
      rent: "/annonces?deal=rent",
      bestValue: "/annonces?deal=sale&sort=cheap",
      villas: "/annonces?cat=villas",
      terrain: "/annonces?cat=terrain",
    });
  });

  it("fills « À découvrir » with what no rail shows, or leaves it out", () => {
    const published = rows("p", 6);
    expect(plan({ published: { rows: published }, mostViewed: published.slice(0, 3) }).explore?.rows.map((r) => r.id)).toEqual(["p4", "p5", "p6"]);
    expect(plan({ published: { rows: published }, mostViewed: published.slice(0, 4) }).explore).toBeNull();
    const off = { ...DEFAULT_RAIL_OPTIONS, enabled: DEFAULT_RAIL_OPTIONS.enabled.filter((k) => k !== "explore") };
    expect(planHomeRails({ published: { rows: published } }, off, NOW).explore).toBeNull();
  });
});

describe("homeRailOptions", () => {
  it("is every rail and twelve cards when nothing is saved", () => {
    expect(homeRailOptions(settingsFromRows([]))).toEqual(DEFAULT_RAIL_OPTIONS);
    expect(DEFAULT_RAIL_OPTIONS.size).toBe(SETTINGS.home_rail_size.default);
  });

  it("reads the console's switches and size", () => {
    const o = homeRailOptions(
      settingsFromRows([
        { key: "home_rail_terrain", value: false },
        { key: "home_rail_most_viewed", value: false },
        { key: "home_rail_size", value: 8 },
      ]),
    );
    expect(o.size).toBe(8);
    expect(o.enabled).not.toContain("terrain");
    expect(o.enabled).not.toContain("mostViewed");
    expect(o.enabled).toContain("villas");
  });

  it("has a switch on the « Accueil » tab for every rail", () => {
    for (const key of HOME_RAIL_KEYS) {
      const def = SETTINGS[RAIL_SETTING[key]];
      expect(def.group, key).toBe("home");
      expect(def.type, key).toBe("bool");
      expect(def.default, key).toBe(true);
    }
  });
});

describe("splitAtMiddle", () => {
  it("puts the larger half first", () => {
    expect(splitAtMiddle([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]]);
    expect(splitAtMiddle([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
    expect(splitAtMiddle([1])).toEqual([[1], []]);
    expect(splitAtMiddle([])).toEqual([[], []]);
  });
});

describe("rail copy", () => {
  // The page reads `home.rails.${key}.title`, which the i18n check can only
  // verify as a prefix. This checks every rail, in both languages.
  it("has an eyebrow, a title and a subtitle for every rail in fr and ar", () => {
    for (const locale of ["fr", "ar"]) {
      const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"));
      for (const key of HOME_RAIL_KEYS) {
        for (const part of ["eyebrow", "title", "sub"]) {
          expect(messages.home.rails[key]?.[part], `${locale}: home.rails.${key}.${part}`).toBeTruthy();
        }
      }
    }
  });
});
