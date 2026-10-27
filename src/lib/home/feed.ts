import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { DEFAULT_RAIL_OPTIONS, HOME_TYPE_RAILS, type HomeRailKey, type HomeRailOptions, type HomeTypeSlug } from "@/lib/home/rails";

/**
 * Home-page data layer.
 *
 * These are the heavy SHARED queries — identical for every visitor — so they
 * are cached for 60s with the cookieless service-role client. Per-user bits
 * (saved hearts, login state) are filled client-side after hydration, which is
 * what lets the whole page be CDN-cached.
 *
 * WHAT CHANGED. Every query here used to read `auctions` joined to
 * `properties`: live lots by `ends_at`, a "recently hammered" rail of
 * `winner_amount`, a count of scheduled lots. Mazed Immo does not sell at auction
 * any more, so a home page built on that data describes a product the visitor
 * cannot buy from. It now reads `listings` — the fixed-price catalogue — and
 * the rails above it render annonces.
 *
 * The rails themselves did not need renaming. "Tendances", "Nouveautés" and
 * "Plus à explorer" are true of a catalogue too; only "Récemment adjugés" had
 * no equivalent and is gone, replaced by `bestValue` — the cheapest published
 * annonces per square metre, which is the thing a property buyer actually
 * scans a home page for.
 *
 * MORE RAILS. The page now has a rail for the most viewed, one for rentals and
 * one per popular type (« Villas », « Terrains »…). Each is one small query,
 * all of them in parallel with the rest, so a cache miss still costs one round
 * trip of wall time. What each rail finally shows — and whether it shows at
 * all — is decided in `./rails.ts`.
 */

export type HomeListingRow = {
  id: string;
  title: string;
  price: number | string | null;
  price_on_request: boolean;
  negotiable: boolean;
  governorate: string;
  delegation: string | null;
  reference: string | null;
  attributes: Record<string, unknown> | null;
  published_at: string | null;
  created_at: string;
  category: { id: string; label_fr: string; label_ar: string | null; kind: string } | null;
  photos: { storage_path: string; sort_order: number }[] | null;
  deal_type: string | null;
  availability: string | null;
  /** Paid placements (0156): « À la une » is built from these. */
  promo_home_featured?: boolean | null;
  promo_banner?: boolean | null;
  promo_expires_at?: string | null;
};

// Trimmed select — only the columns AnnonceCard, the hero builder and the rail
// plan read.
const HOME_LISTING_COLUMNS = `
  id, title, price, price_on_request, negotiable, governorate, delegation,
  reference, attributes, published_at, created_at, deal_type, availability,
  promo_home_featured, promo_banner, promo_expires_at,
  photos:listing_photos ( storage_path, sort_order )
`;
const HOME_LISTING_SELECT = `${HOME_LISTING_COLUMNS},
  category:categories!listings_category_id_fkey ( id, label_fr, label_ar, kind )`;
// The same, joined `!inner` so a type rail can filter on the category's slug
// in the one query — no lookup of the category's id first.
const HOME_TYPE_SELECT = `${HOME_LISTING_COLUMNS},
  category:categories!listings_category_id_fkey!inner ( id, slug, label_fr, label_ar, kind )`;

export type HomeFeed = {
  /** Published annonces, paid home placement first, then most viewed. Drives
   *  « À la une », the hero and « À découvrir ». */
  published: { rows: HomeListingRow[]; count: number };
  /** The newest arrivals rail. */
  nouveautes: HomeListingRow[];
  /** « Les plus vus »: by `view_count`, an annonce nobody opened left out. */
  mostViewed: HomeListingRow[];
  /** « À louer »: the newest rentals. */
  rentals: HomeListingRow[];
  /** One rail per popular type, keyed by category slug (HOME_TYPE_RAILS). */
  byType: Partial<Record<HomeTypeSlug, HomeListingRow[]>>;
  /** Cheapest per m², for the "bonnes affaires" rail. */
  bestValue: HomeListingRow[];
  /** Published in the last 7 days — a hero figure. */
  newThisWeek: number;
  /** Distinct governorates with at least one published annonce. */
  govs: string[];
};

/** m² price, or null when the listing cannot answer the question. A rent is a
 *  monthly figure: 1 200 TND for 110 m² is not a bargain flat, it is a month's
 *  rent, and it would top a "cheapest per m²" rail of sales every time. */
function pricePerSqm(r: HomeListingRow): number | null {
  if (r.deal_type === "rent") return null;
  if (r.price_on_request || r.price == null) return null;
  const area = Number((r.attributes ?? {}).area_sqm);
  const price = Number(r.price);
  if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(price) || price <= 0) return null;
  return price / area;
}

/**
 * The parallel home queries, cached 60s under the `home-feed` tag.
 *
 * `weekStart` (bucketed to the day) keys the "new this week" count so the cache
 * stays stable within a day rather than churning on every request.
 *
 * `options` are the console's (`home_rail_*`): a rail switched off is not
 * queried, and `size` is each rail query's limit. They are arguments, so they
 * are part of the cache key: a change in the console is a new feed on the next
 * build of the page, not one served from the old settings for a minute more.
 */
export const getHomeFeed = unstable_cache(
  async (weekStart: string, options: HomeRailOptions = DEFAULT_RAIL_OPTIONS): Promise<HomeFeed | null> => {
    const sb = getServiceSupabase();
    if (!sb) return null;
    const on = new Set(options.enabled);
    const size = options.size;
    // A switched-off rail: no round trip, no cards.
    const OFF = { data: null, error: null } as const;
    // We only reach here on a CACHE MISS (unstable_cache short-circuits hits
    // before invoking this fn), so every line below is a real round trip.
    const fperf = log.scope("home:feed");
    // published, newThisWeek and govs always run; each rail query only when on.
    const queried: HomeRailKey[] = ["nouveautes", "mostViewed", "rent", ...HOME_TYPE_RAILS];
    const queries = 3 + queried.filter((k) => on.has(k)).length;
    const endTotal = fperf.time(`MISS — ran ${queries} parallel queries`);
    const timed = <T,>(label: string, p: PromiseLike<T>): Promise<T> => {
      const end = fperf.time(label);
      return Promise.resolve(p).then((r) => { end(); return r; });
    };
    // The published slice feeds the hero, « À la une », « Bonnes affaires » and
    // « À découvrir »: at least two rails' worth.
    const publishedLimit = Math.max(24, size * 2);

    const [publishedRes, nouveautesRes, newWeekRes, govRes, mostViewedRes, rentalsRes, typeRes] = await Promise.all([
      timed(
        `q1 published(${publishedLimit})`,
        sb
          .from("listings")
          .select(HOME_LISTING_SELECT, { count: "exact" })
          .eq("status", "published")
          // "Les biens du moment": paid home placement, then what people open.
          // Sorted by date it was the same list, in the same order, as
          // "Fraîchement publiés" two rails further down.
          // The banner placement (0156) opens the hero carousel, built from the first of these.
          .order("promo_banner", { ascending: false, nullsFirst: false })
          .order("promo_home_featured", { ascending: false, nullsFirst: false })
          .order("view_count", { ascending: false, nullsFirst: false })
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(publishedLimit),
      ),
      // A few more than a rail holds, here and in « Les plus vus »: the rails
      // above them take their annonces out first.
      on.has("nouveautes")
        ? timed(
            `q2 nouveautes(${size + 4})`,
            sb
              .from("listings")
              .select(HOME_LISTING_SELECT)
              .eq("status", "published")
              .order("created_at", { ascending: false })
              .limit(size + 4),
          )
        : OFF,
      timed(
        "q3 newThisWeek",
        sb
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .gte("published_at", weekStart),
      ),
      // Coverage figure. Capped rather than aggregated because Postgrest has no
      // `count(distinct)` — 500 rows is plenty to see all 24 governorates, and
      // it is a head-of-page statistic, not a report.
      timed(
        "q4 govs(500)",
        sb
          .from("listings")
          .select("governorate")
          .eq("status", "published")
          .limit(500),
      ),
      on.has("mostViewed")
        ? timed(
            `q5 mostViewed(${size + 4})`,
            sb
              .from("listings")
              .select(HOME_LISTING_SELECT)
              .eq("status", "published")
              .gt("view_count", 0)
              .order("view_count", { ascending: false })
              .order("published_at", { ascending: false, nullsFirst: false })
              .limit(size + 4),
          )
        : OFF,
      on.has("rent")
        ? timed(
            `q6 rentals(${size})`,
            sb
              .from("listings")
              .select(HOME_LISTING_SELECT)
              .eq("status", "published")
              .eq("deal_type", "rent")
              .order("published_at", { ascending: false, nullsFirst: false })
              .limit(size),
          )
        : OFF,
      Promise.all(
        HOME_TYPE_RAILS.map((slug) =>
          on.has(slug)
            ? timed(
                `q7 type:${slug}(${size})`,
                sb
                  .from("listings")
                  .select(HOME_TYPE_SELECT)
                  .eq("status", "published")
                  .eq("category.slug", slug)
                  .order("published_at", { ascending: false, nullsFirst: false })
                  .limit(size),
              )
            : OFF,
        ),
      ),
    ]);
    endTotal();

    const rows = (publishedRes.data ?? []) as unknown as HomeListingRow[];
    // A failed rail query is an empty rail — it hides itself — not a failed
    // page. Said in the log, or a rail that never appears looks like a quiet day.
    if (nouveautesRes.error) fperf.warn("nouveautes query failed", nouveautesRes.error);
    if (mostViewedRes.error) fperf.warn("mostViewed query failed", mostViewedRes.error);
    if (rentalsRes.error) fperf.warn("rentals query failed", rentalsRes.error);
    typeRes.forEach((res, i) => {
      if (res.error) fperf.warn(`type:${HOME_TYPE_RAILS[i]} query failed`, res.error);
    });

    // Best value is derived, not a fifth query: the published slice is already
    // in hand, and a listing with no surface simply cannot answer "per m²" —
    // it is excluded rather than sorted to the bottom with a fake number.
    const bestValue = on.has("bestValue")
      ? rows
          .map((r) => ({ r, ppsm: pricePerSqm(r) }))
          .filter((x): x is { r: HomeListingRow; ppsm: number } => x.ppsm != null)
          .sort((a, b) => a.ppsm - b.ppsm)
          .slice(0, size)
          .map((x) => x.r)
      : [];
    return {
      published: { rows, count: publishedRes.count ?? rows.length },
      nouveautes: (nouveautesRes.data ?? []) as unknown as HomeListingRow[],
      mostViewed: (mostViewedRes.data ?? []) as unknown as HomeListingRow[],
      rentals: (rentalsRes.data ?? []) as unknown as HomeListingRow[],
      byType: Object.fromEntries(
        HOME_TYPE_RAILS.map((slug, i) => [slug, (typeRes[i].data ?? []) as unknown as HomeListingRow[]]),
      ),
      bestValue,
      newThisWeek: newWeekRes.count ?? 0,
      govs: (govRes.data ?? [])
        .map((r) => (r as { governorate: string | null }).governorate)
        .filter((g): g is string => typeof g === "string" && g.length > 0),
    };
  },
  ["home-feed"],
  { revalidate: 60, tags: ["home-feed"] },
);
