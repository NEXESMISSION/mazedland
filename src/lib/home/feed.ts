import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

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
 * `winner_amount`, a count of scheduled lots. Batta does not sell at auction
 * any more, so a home page built on that data describes a product the visitor
 * cannot buy from. It now reads `listings` — the fixed-price catalogue — and
 * the rails above it render annonces.
 *
 * The rails themselves did not need renaming. "Tendances", "Nouveautés" and
 * "Plus à explorer" are true of a catalogue too; only "Récemment adjugés" had
 * no equivalent and is gone, replaced by `bestValue` — the cheapest published
 * annonces per square metre, which is the thing a property buyer actually
 * scans a home page for.
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
  category: { id: string; label_fr: string; kind: string } | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

// Trimmed select — only the columns AnnonceCard and the hero builder read.
const HOME_LISTING_SELECT = `
  id, title, price, price_on_request, negotiable, governorate, delegation,
  reference, attributes, published_at, created_at,
  category:categories!listings_category_id_fkey ( id, label_fr, kind ),
  photos:listing_photos ( storage_path, sort_order )
`;

export type HomeFeed = {
  /** Published annonces, newest first. Drives the trending rail and the grid. */
  published: { rows: HomeListingRow[]; count: number };
  /** The newest arrivals rail. */
  nouveautes: HomeListingRow[];
  /** Cheapest per m², for the "bonnes affaires" rail. */
  bestValue: HomeListingRow[];
  /** Published in the last 7 days — a hero figure. */
  newThisWeek: number;
  /** Distinct governorates with at least one published annonce. */
  govs: string[];
};

/** m² price, or null when the listing cannot answer the question. */
function pricePerSqm(r: HomeListingRow): number | null {
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
 */
export const getHomeFeed = unstable_cache(
  async (weekStart: string): Promise<HomeFeed | null> => {
    const sb = getServiceSupabase();
    if (!sb) return null;
    // We only reach here on a CACHE MISS (unstable_cache short-circuits hits
    // before invoking this fn), so every line below is a real round trip.
    const fperf = log.scope("home:feed");
    const endTotal = fperf.time("MISS — ran 4 parallel queries");
    const timed = <T,>(label: string, p: PromiseLike<T>): Promise<T> => {
      const end = fperf.time(label);
      return Promise.resolve(p).then((r) => { end(); return r; });
    };

    const [publishedRes, nouveautesRes, newWeekRes, govRes] = await Promise.all([
      timed(
        "q1 published(24)",
        sb
          .from("listings")
          .select(HOME_LISTING_SELECT, { count: "exact" })
          .eq("status", "published")
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(24),
      ),
      timed(
        "q2 nouveautes(14)",
        sb
          .from("listings")
          .select(HOME_LISTING_SELECT)
          .eq("status", "published")
          .order("created_at", { ascending: false })
          .limit(14),
      ),
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
    ]);
    endTotal();

    const rows = (publishedRes.data ?? []) as unknown as HomeListingRow[];

    // Best value is derived, not a fifth query: the published slice is already
    // in hand, and a listing with no surface simply cannot answer "per m²" —
    // it is excluded rather than sorted to the bottom with a fake number.
    const bestValue = rows
      .map((r) => ({ r, ppsm: pricePerSqm(r) }))
      .filter((x): x is { r: HomeListingRow; ppsm: number } => x.ppsm != null)
      .sort((a, b) => a.ppsm - b.ppsm)
      .slice(0, 12)
      .map((x) => x.r);

    return {
      published: { rows, count: publishedRes.count ?? rows.length },
      nouveautes: (nouveautesRes.data ?? []) as unknown as HomeListingRow[],
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
