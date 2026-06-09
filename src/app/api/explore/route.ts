import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import type { AuctionWithProperty, PropertyType } from "@/lib/types";
import { withRouteLogger } from "@/lib/withRouteLogger";
import { stripAccents } from "@/lib/search";
import { log } from "@/lib/log";

const xLog = log.scope("api");

type ExploreParams = {
  filter: "all" | "auction" | "direct";
  types: PropertyType[];
  gov: string | null;
  term: string;
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  minRooms: number | null;
  from: number;
  to: number;
};

// The explore feed is PUBLIC data only (browseable auctions on ready
// properties — no per-user rows), so it's identical for everyone and safe to
// serve from the cookieless service-role client behind unstable_cache. This
// mirrors the home/catalogue feeds and stops every pagination/filter click
// from hitting Postgres with an uncached join + count. Keyed by every filter
// input; 30s revalidate balances freshness against a cold-cache DB storm.
const fetchExplore = unstable_cache(
  async (p: ExploreParams) => {
    const supabase = getServiceSupabase();
    if (!supabase) return { items: [] as AuctionWithProperty[], count: 0, error: "server_misconfigured" };

    let q = supabase
      .from("auctions")
      .select(
        `
        *,
        property:properties!inner (
          *,
          photos:property_photos (id, storage_path, sort_order, caption)
        )
      `,
        { count: "exact" },
      )
      .in("status", ["scheduled", "live", "extending"])
      .eq("property.status", "ready")
      .order("created_at", { ascending: false })
      .range(p.from, p.to);

    if (p.filter === "auction") q = q.eq("listing_type", "auction");
    else if (p.filter === "direct") q = q.eq("listing_type", "direct");

    if (p.types.length > 0) q = q.in("property.type", p.types);
    if (p.gov) q = q.eq("property.governorate", p.gov);
    if (p.term) q = q.ilike("property.search_text", `%${stripAccents(p.term)}%`);
    if (p.minArea !== null) q = q.gte("property.area_sqm", p.minArea);
    if (p.minRooms !== null) q = q.gte("property.rooms", p.minRooms);
    // Single coalesced, indexed effective price (0119) — the price actually
    // shown on the card. Replaces the old or(current,sale,opening) which both
    // defeated indexes and wrongly matched a bid-up lot via its low opening.
    if (p.minPrice !== null) q = q.gte("effective_price", p.minPrice);
    if (p.maxPrice !== null) q = q.lte("effective_price", p.maxPrice);

    const { data, error, count } = await q;
    if (error) {
      xLog.error("explore select failed", error);
      return { items: [] as AuctionWithProperty[], count: 0, error: "explore_failed" };
    }
    return {
      items: (data ?? []) as unknown as AuctionWithProperty[],
      count: count ?? 0,
      error: null as string | null,
    };
  },
  ["explore-feed"],
  { revalidate: 30 },
);

/**
 * GET /api/explore — page-numbered listing feed (1, 2, 3, …).
 *
 * Query:
 *   filter     = "all" | "auction" | "direct"   (default "all")
 *   types      = comma-separated property types (apartment, villa, …)
 *   gov        = governorate exact match (e.g. "Tunis")
 *   min_price  = numeric; filtered against current/sale/opening price
 *   max_price  = numeric
 *   min_area   = numeric m²
 *   min_rooms  = numeric
 *   page       = 1-based page number (default 1)
 *   limit      = 1..24  (default 12)
 *
 * Response: {
 *   items: AuctionWithProperty[],
 *   page: number,         // 1-based
 *   totalPages: number,
 *   totalCount: number,
 *   limit: number,
 * }
 *
 * Only browseable listings are returned: auction.status in
 * (scheduled, live, extending) AND the linked property is approved
 * (status = 'ready'). Same gate the catalogue grid uses, so the feed
 * never shows a listing the buyer couldn't open.
 *
 * Price filtering is done against the *current* price field — that's
 * current_price for live English/sealed auctions or sale_price for
 * direct listings. We use opening_price as a fallback when the live
 * fields are null (scheduled auctions with no bids yet).
 */
const VALID_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

export const GET = withRouteLogger(async (req: NextRequest) => {
  const url = req.nextUrl;
  const sp = url.searchParams;

  const filterRaw = sp.get("filter") ?? "all";
  const filter: "all" | "auction" | "direct" =
    filterRaw === "auction" || filterRaw === "direct" ? filterRaw : "all";

  const typesRaw = sp.get("types") ?? "";
  const types = typesRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PropertyType => (VALID_TYPES as string[]).includes(s));

  const gov = sp.get("gov")?.trim() || null;
  // Free-text search across the listing's title / location. Stripped of the
  // characters that have meaning inside a PostgREST or() filter so a stray
  // comma or paren can't break the query.
  const term = (sp.get("q") ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const minPrice = numOrNull(sp.get("min_price"));
  const maxPrice = numOrNull(sp.get("max_price"));
  const minArea = numOrNull(sp.get("min_area"));
  const minRooms = numOrNull(sp.get("min_rooms"));

  const page = clamp(Number(sp.get("page") ?? 1), 1, 9999);
  const limit = clamp(Number(sp.get("limit") ?? 12), 1, 24);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const stopTimer = xLog.time("explore.select");
  const { items, count, error } = await fetchExplore({
    filter, types, gov, term, minPrice, maxPrice, minArea, minRooms, from, to,
  });
  stopTimer();

  if (error) {
    // Generic error to the client; the real cause is logged server-side.
    return NextResponse.json({ error: "explore_failed" }, { status: 500 });
  }

  const totalCount = count || items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return NextResponse.json({
    items,
    page,
    totalPages,
    totalCount,
    limit,
  });
});

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function numOrNull(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
