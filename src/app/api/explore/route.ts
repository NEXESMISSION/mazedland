import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty, PropertyType } from "@/lib/types";
import { withRouteLogger } from "@/lib/withRouteLogger";
import { log } from "@/lib/log";

const xLog = log.scope("api");

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
  const minPrice = numOrNull(sp.get("min_price"));
  const maxPrice = numOrNull(sp.get("max_price"));
  const minArea = numOrNull(sp.get("min_area"));
  const minRooms = numOrNull(sp.get("min_rooms"));

  const page = clamp(Number(sp.get("page") ?? 1), 1, 9999);
  const limit = clamp(Number(sp.get("limit") ?? 12), 1, 24);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = await getServerSupabase();

  // `count: 'exact'` makes PostgREST return the total row count alongside
  // the page slice in a single round-trip. We use it to compute totalPages
  // for the numbered pagination UI.
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
    .range(from, to);

  if (filter === "auction") q = q.eq("listing_type", "auction");
  else if (filter === "direct") q = q.eq("listing_type", "direct");

  if (types.length > 0) q = q.in("property.type", types);
  if (gov) q = q.eq("property.governorate", gov);
  if (minArea !== null) q = q.gte("property.area_sqm", minArea);
  if (minRooms !== null) q = q.gte("property.rooms", minRooms);

  // Price filter — we OR across the three price columns so a listing
  // passes if ANY of (current_price | sale_price | opening_price) falls
  // in the window. This keeps the filter forgiving: a scheduled auction
  // with no bid still appears at its opening price.
  if (minPrice !== null) {
    q = q.or(
      `current_price.gte.${minPrice},sale_price.gte.${minPrice},opening_price.gte.${minPrice}`,
    );
  }
  if (maxPrice !== null) {
    q = q.or(
      `current_price.lte.${maxPrice},sale_price.lte.${maxPrice},opening_price.lte.${maxPrice}`,
    );
  }

  const stopTimer = xLog.time("explore.select");
  const { data, error, count } = await q;
  stopTimer();

  if (error) {
    xLog.error("explore select failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []) as unknown as AuctionWithProperty[];
  const totalCount = count ?? items.length;
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
