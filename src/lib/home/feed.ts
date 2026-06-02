import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * Home-page data layer. Extracted from the page component so the route file
 * stays focused on rendering. These are the heavy SHARED queries — identical
 * for every visitor — so they're cached for 60s with the cookieless
 * service-role client (public `status='ready'` rows, no per-user scoping;
 * `unstable_cache` can't read request cookies anyway). Per-user bits (saved
 * hearts, login) are filled client-side after hydration, which is what lets
 * the whole page be CDN-cached.
 */

// Row type for the "Recently hammered" rail.
export type HammeredRow = {
  id: string;
  winner_amount: number | string | null;
  hammer_at: string | null;
  type: string;
  property: {
    title: string;
    governorate: string;
    photos?: { id: string; storage_path: string; sort_order: number }[];
  };
};

// Trimmed selects — only the columns PropertyCard + the hero builders read,
// not the full auctions.*/properties.* rows. promo_* drive the paid-placement
// sort.
const HOME_AUCTION_SELECT = `
  id, status, type, listing_type, opening_price, current_price, ends_at, created_at,
  property:properties!inner (
    id, title, governorate, status, promo_banner, promo_home_featured,
    photos:property_photos ( id, storage_path, sort_order )
  )
`;
const HOME_HAMMERED_SELECT = `
  id, winner_amount, hammer_at, type,
  property:properties!inner (
    title, governorate, status,
    photos:property_photos ( id, storage_path, sort_order )
  )
`;

export type HomeFeed = {
  live: { rows: unknown[]; count: number };
  hammered: unknown[];
  nouveautes: unknown[];
  scheduledCount: number;
  soldThisMonthCount: number;
  govs: string[];
};

/**
 * The 6 parallel home queries, cached 60s under the `home-feed` tag.
 * `monthStart` (bucketed to the day) keys the "sold this month" count so the
 * cache stays stable within a day.
 */
export const getHomeFeed = unstable_cache(
  async (monthStart: string): Promise<HomeFeed | null> => {
    const sb = getServiceSupabase();
    if (!sb) return null;
    // We only reach here on a CACHE MISS (unstable_cache short-circuits hits
    // before invoking this fn), so every line below is a real Supabase
    // round-trip. Time each query individually to see which dominates.
    const fperf = log.scope("home:feed");
    const endTotal = fperf.time("MISS — ran 6 parallel queries");
    const timed = <T,>(label: string, p: PromiseLike<T>): Promise<T> => {
      const end = fperf.time(label);
      return Promise.resolve(p).then((r) => {
        end();
        return r;
      });
    };
    const [liveRes, hammeredRes, nouveautesRes, scheduledRes, soldMonthRes, govRes] =
      await Promise.all([
        timed("q1 live(18)", sb.from("auctions").select(HOME_AUCTION_SELECT, { count: "exact" })
          .in("status", ["scheduled", "live", "extending"])
          .eq("property.status", "ready")
          .order("ends_at", { ascending: true })
          .limit(18)),
        timed("q2 hammered(14)", sb.from("auctions").select(HOME_HAMMERED_SELECT)
          .in("status", ["ended_sold", "awarded"])
          .eq("property.status", "ready")
          .order("hammer_at", { ascending: false })
          .limit(14)),
        timed("q3 nouveautes(14)", sb.from("auctions").select(HOME_AUCTION_SELECT)
          .in("status", ["scheduled", "live", "extending"])
          .eq("property.status", "ready")
          .order("created_at", { ascending: false })
          .limit(14)),
        timed("q4 scheduledCount", sb.from("auctions").select("id", { count: "exact", head: true })
          .eq("status", "scheduled")),
        timed("q5 soldThisMonth", sb.from("auctions").select("id", { count: "exact", head: true })
          .in("status", ["ended_sold", "awarded"])
          .gte("hammer_at", monthStart)),
        timed("q6 govs(500)", sb.from("properties").select("governorate").eq("status", "ready").limit(500)),
      ]);
    endTotal();
    return {
      live: { rows: liveRes.data ?? [], count: liveRes.count ?? (liveRes.data?.length ?? 0) },
      hammered: hammeredRes.data ?? [],
      nouveautes: nouveautesRes.data ?? [],
      scheduledCount: scheduledRes.count ?? 0,
      soldThisMonthCount: soldMonthRes.count ?? 0,
      govs: (govRes.data ?? [])
        .map((r) => (r as { governorate: string | null }).governorate)
        .filter((g): g is string => typeof g === "string" && g.length > 0),
    };
  },
  ["home-feed"],
  { revalidate: 60, tags: ["home-feed"] },
);
