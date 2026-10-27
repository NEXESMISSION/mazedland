import type { HomeFeed, HomeListingRow } from "@/lib/home/feed";
import type { Settings } from "@/lib/settings/registry";
import { catalogueHrefFor } from "@/lib/catalog/browse";

/**
 * Which rails of annonces the home page shows, in which order, holding what.
 *
 * Both layouts — the phone page and HomeDesktop — render this one list, so the
 * two cannot disagree about what a rail holds or when it disappears. Pure: the
 * feed comes in, the rails come out, and `rails.test.ts` covers the rules.
 *
 * The rules:
 *   - A rail the console has switched off (`home_rail_*`) is not there: the
 *     feed does not query it, and the plan does not show it.
 *   - A rail with fewer than MIN_RAIL_CARDS annonces is not shown. Three cards
 *     is the least that reads as a section rather than a leftover, and a rail
 *     comes back on its own once there are annonces to fill it.
 *   - « À la une », « Les plus vus » and « Nouveautés » answer the same
 *     question — what is worth opening — from one small inventory, so each
 *     leaves out what an earlier one shows. Otherwise the page opens on the
 *     same cards three times over.
 *   - The rails that cut the catalogue by a criterion — the rentals, the
 *     cheapest per m², one type — are exempt. A villa in « Les plus vus » is
 *     still a villa, and « Villas » would be wrong without it.
 *   - « À découvrir » closes the list with what no rail above shows.
 */

/** A rail with fewer cards than this reads as a leftover, not a section. */
export const MIN_RAIL_CARDS = 3;

/** « À découvrir » is a grid on the phone: two columns, four rows at most. */
const EXPLORE_MAX_CARDS = 8;

/**
 * The categories with a rail of their own (`categories.slug`), in the order of
 * the type tiles further down the page. A type that does not have three
 * annonces yet costs one small query and shows nothing.
 */
export const HOME_TYPE_RAILS = ["appartements", "villas", "maisons", "terrain"] as const;
export type HomeTypeSlug = (typeof HOME_TYPE_RAILS)[number];

export type HomeRailKey =
  | "featured"
  | "mostViewed"
  | "nouveautes"
  | "rent"
  | "bestValue"
  | HomeTypeSlug
  | "explore";

/** Every rail the page can show. The copy is `home.rails.<key>.{eyebrow,title,sub}`. */
export const HOME_RAIL_KEYS: readonly HomeRailKey[] = [
  "featured", "mostViewed", "nouveautes", "rent", "bestValue", ...HOME_TYPE_RAILS, "explore",
];

/** The console switch of each rail (src/lib/settings/registry.ts, tab « Accueil »). */
export const RAIL_SETTING = {
  featured: "home_rail_featured",
  mostViewed: "home_rail_most_viewed",
  nouveautes: "home_rail_new",
  rent: "home_rail_rent",
  bestValue: "home_rail_deals",
  appartements: "home_rail_appartements",
  villas: "home_rail_villas",
  maisons: "home_rail_maisons",
  terrain: "home_rail_terrain",
  explore: "home_rail_explore",
} as const satisfies Record<HomeRailKey, keyof Settings>;

export type HomeRailOptions = {
  /** Cards per rail (`home_rail_size`): the limit of each rail's query. */
  size: number;
  /** The rails switched on, in HOME_RAIL_KEYS order. Part of the feed's cache
   *  key, so switching one off in the console is a fresh feed, not a stale one. */
  enabled: HomeRailKey[];
};

/** Every rail on, twelve cards each: the registry's defaults. */
export const DEFAULT_RAIL_OPTIONS: HomeRailOptions = { size: 12, enabled: [...HOME_RAIL_KEYS] };

/** The rail options the console's settings ask for. */
export function homeRailOptions(
  s: Pick<Settings, (typeof RAIL_SETTING)[HomeRailKey] | "home_rail_size">,
): HomeRailOptions {
  return { size: s.home_rail_size, enabled: HOME_RAIL_KEYS.filter((k) => s[RAIL_SETTING[k]]) };
}

export type HomeRail = {
  key: HomeRailKey;
  rows: HomeListingRow[];
  /** « Tout voir »: the catalogue search the rail is the first cards of. */
  href: string;
  /** The rail's cards are paid placements, and its heading says so. */
  sponsored?: boolean;
};

/** The feed as the plan reads it. Every list is optional: a cached feed from
 *  before a rail existed simply has no cards for it. */
export type HomeRailsInput = Partial<Pick<HomeFeed, "nouveautes" | "mostViewed" | "rentals" | "bestValue" | "byType">> & {
  published?: { rows: HomeListingRow[] };
};

/**
 * A paid home placement that is still running. The expiry job clears the flags
 * every 15 minutes (0156); checking the date here keeps a placement that has
 * just ended from riding the top of the page until it does.
 */
export function isOnHome(r: HomeListingRow, now: number): boolean {
  if (!r.promo_home_featured && !r.promo_banner) return false;
  if (!r.promo_expires_at) return true;
  const ends = Date.parse(r.promo_expires_at);
  return !Number.isFinite(ends) || ends > now;
}

/** `now` is for the tests; the page reads the clock when it is built. */
export function planHomeRails(
  feed: HomeRailsInput | null | undefined,
  options: HomeRailOptions = DEFAULT_RAIL_OPTIONS,
  now: number = Date.now(),
): { rails: HomeRail[]; explore: HomeRail | null } {
  const published = feed?.published?.rows ?? [];
  const on = new Set(options.enabled);
  const shown = new Set<string>();
  const rails: HomeRail[] = [];

  /** Keeps a rail that is switched on and has enough cards, and remembers what it shows. */
  const add = (rail: HomeRail, opts: { dedupe: boolean }) => {
    if (!on.has(rail.key)) return;
    const rows = (opts.dedupe ? rail.rows.filter((r) => !shown.has(r.id)) : rail.rows).slice(0, options.size);
    if (rows.length < MIN_RAIL_CARDS) return;
    for (const r of rows) shown.add(r.id);
    rails.push({ ...rail, rows });
  };

  // The published slice is already ordered banner, then home placement, then
  // views — the order the paid placements were sold on — so « À la une » is
  // its head, not another query.
  add(
    { key: "featured", rows: published.filter((r) => isOnHome(r, now)), href: "/annonces", sponsored: true },
    { dedupe: true },
  );
  // The catalogue has no « most viewed » order to open, so these two link to
  // its default: the newest first.
  add({ key: "mostViewed", rows: feed?.mostViewed ?? [], href: "/annonces" }, { dedupe: true });
  add({ key: "nouveautes", rows: feed?.nouveautes ?? [], href: "/annonces" }, { dedupe: true });
  add({ key: "rent", rows: feed?.rentals ?? [], href: catalogueHrefFor({ deal: "rent" }) }, { dedupe: false });
  // Sales only (a month's rent has no price per m²), cheapest first: the
  // nearest the catalogue comes to « cheapest per m² ».
  add({ key: "bestValue", rows: feed?.bestValue ?? [], href: "/annonces?deal=sale&sort=cheap" }, { dedupe: false });
  for (const slug of HOME_TYPE_RAILS) {
    add({ key: slug, rows: feed?.byType?.[slug] ?? [], href: catalogueHrefFor({ cat: slug }) }, { dedupe: false });
  }

  const rest = on.has("explore") ? published.filter((r) => !shown.has(r.id)).slice(0, EXPLORE_MAX_CARDS) : [];
  const explore = rest.length >= MIN_RAIL_CARDS ? { key: "explore" as const, rows: rest, href: "/annonces" } : null;

  return { rails, explore };
}

/**
 * The rails above and below the middle advertising space: the first half,
 * rounded up, then the rest. Rails hide themselves, so the middle of the page
 * is counted in the rails actually shown, not in the rails there could be.
 */
export function splitAtMiddle<T>(items: readonly T[]): [T[], T[]] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}
