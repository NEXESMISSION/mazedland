import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty, PropertyType } from "@/lib/types";
import { ExploreView } from "@/components/explore/ExploreView";
import type { ExploreFilter } from "@/components/explore/ExploreFeed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 12;

const VALID_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

/**
 * Explore — paginated listing index.
 *
 * The server fetches page 1 of the catalogue (12 items) plus the total
 * row count, the user's auth state, and the user's saved-auction ids
 * so the heart icon paints filled on first render. The client-side
 * <ExploreView/> takes over from there: filter switching, page jumps
 * (1, 2, 3, …), and view-mode toggle (grid ↔ reels) are all driven
 * through /api/explore.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    types?: string;
    gov?: string;
    q?: string;
    min_price?: string;
    max_price?: string;
    min_area?: string;
    min_rooms?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const initialFilter: ExploreFilter =
    sp.filter === "auction" || sp.filter === "direct" ? sp.filter : "all";

  const types = (sp.types ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PropertyType => (VALID_TYPES as string[]).includes(s));
  const gov = sp.gov?.trim() || null;
  // Free-text keyword (from the home hero search). Sanitised exactly like
  // /api/explore so a stray comma/paren can't break the PostgREST or().
  const term = (sp.q ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const minPrice = numOrNull(sp.min_price);
  const maxPrice = numOrNull(sp.max_price);
  const minArea = numOrNull(sp.min_area);
  const minRooms = numOrNull(sp.min_rooms);
  const initialPage = clamp(Number(sp.page ?? 1), 1, 9999);
  const from = (initialPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let items: AuctionWithProperty[] = [];
  let totalCount = 0;
  let totalPages = 1;
  let loggedIn = false;
  let savedAuctionIds: string[] = [];

  try {
    const supabase = await getServerSupabase();
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

    if (initialFilter === "auction") q = q.eq("listing_type", "auction");
    else if (initialFilter === "direct") q = q.eq("listing_type", "direct");

    if (types.length > 0) q = q.in("property.type", types);
    if (gov) q = q.eq("property.governorate", gov);
    if (term) {
      q = q.or(
        `title.ilike.*${term}*,governorate.ilike.*${term}*,address.ilike.*${term}*`,
        { referencedTable: "property" },
      );
    }
    if (minArea !== null) q = q.gte("property.area_sqm", minArea);
    if (minRooms !== null) q = q.gte("property.rooms", minRooms);
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

    const [rowsRes, userRes] = await Promise.all([q, supabase.auth.getUser()]);
    if (rowsRes.error) {
      console.error("[/properties] supabase error", rowsRes.error);
    }
    items = (rowsRes.data ?? []) as unknown as AuctionWithProperty[];
    totalCount = rowsRes.count ?? items.length;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    loggedIn = !!userRes.data.user;

    if (loggedIn && items.length > 0) {
      const ids = items.map((a) => a.id);
      const { data: saves } = await supabase
        .from("watchlist")
        .select("auction_id")
        .eq("user_id", userRes.data.user!.id)
        .in("auction_id", ids);
      savedAuctionIds = (saves ?? []).map((s) => s.auction_id as string);
    }
  } catch (err) {
    console.warn(
      "[/properties] supabase unavailable:",
      err instanceof Error ? err.message : err,
    );
  }

  return (
    <ExploreView
      initialItems={items}
      initialFilter={initialFilter}
      initialPage={initialPage}
      initialTotalPages={totalPages}
      initialTotalCount={totalCount}
      loggedIn={loggedIn}
      savedAuctionIds={savedAuctionIds}
      initialSearch={term}
      initialExtra={{
        types,
        gov,
        minPrice,
        maxPrice,
        minArea,
        minRooms,
      }}
    />
  );
}

function numOrNull(v: string | null | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
