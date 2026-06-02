import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import type { AuctionWithProperty, PropertyType } from "@/lib/types";
import { ExploreView } from "@/components/explore/ExploreView";
import type { ExploreFilter } from "@/components/explore/types";
import { stripAccents } from "@/lib/search";

export const metadata: Metadata = {
  title: "Biens immobiliers aux enchères",
  description:
    "Parcourez les biens immobiliers en vente aux enchères et en vente directe partout en Tunisie — appartements, maisons, villas, terrains et locaux. Mises à prix transparentes sur Batta.tn.",
  alternates: { canonical: "/fr/properties" },
  openGraph: {
    title: "Biens immobiliers aux enchères — Batta.tn",
    description:
      "Tous les biens en vente aux enchères et en vente directe en Tunisie, en un seul endroit.",
    type: "website",
    url: "/fr/properties",
  },
};

const PAGE_SIZE = 12;

const VALID_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

type ExploreQueryParams = {
  filter: ExploreFilter;
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

/**
 * The catalogue page is the same for every visitor — listings are public
 * (status scheduled/live/extending + property ready) and the saved-heart /
 * login state is filled in client-side after hydration (see WatchlistButton:
 * the server `loggedIn` is only a pre-hydration fallback). So we cache the
 * heavy join+count query per filter-combination for 60s with the cookieless
 * service-role client — exactly the home-feed pattern — instead of running a
 * full DB round-trip + an auth.getUser() on every single visit. At scale this
 * turns the app's second-busiest page from per-request DB work into mostly
 * cache hits.
 */
const getExploreFeed = unstable_cache(
  async (
    p: ExploreQueryParams,
  ): Promise<{ items: AuctionWithProperty[]; totalCount: number }> => {
    const sb = getServiceSupabase();
    if (!sb) return { items: [], totalCount: 0 };

    let q = sb
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
    if (p.term) {
      // Accent-folded match against the property's search_text generated
      // column (migration 0062) — diacritic-insensitive, trigram-indexed.
      q = q.ilike("property.search_text", `%${stripAccents(p.term)}%`);
    }
    if (p.minArea !== null) q = q.gte("property.area_sqm", p.minArea);
    if (p.minRooms !== null) q = q.gte("property.rooms", p.minRooms);
    if (p.minPrice !== null) {
      q = q.or(
        `current_price.gte.${p.minPrice},sale_price.gte.${p.minPrice},opening_price.gte.${p.minPrice}`,
      );
    }
    if (p.maxPrice !== null) {
      q = q.or(
        `current_price.lte.${p.maxPrice},sale_price.lte.${p.maxPrice},opening_price.lte.${p.maxPrice}`,
      );
    }

    const res = await q;
    if (res.error) {
      console.error("[/properties] supabase error", res.error);
    }
    const items = (res.data ?? []) as unknown as AuctionWithProperty[];
    return { items, totalCount: res.count ?? items.length };
  },
  ["explore-feed"],
  { revalidate: 60, tags: ["explore-feed"] },
);

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
  // Filled client-side by the watchlist store; kept empty server-side.
  const savedAuctionIds: string[] = [];

  try {
    const feed = await getExploreFeed({
      filter: initialFilter,
      types,
      gov,
      term,
      minPrice,
      maxPrice,
      minArea,
      minRooms,
      from,
      to,
    });
    items = feed.items;
    totalCount = feed.totalCount;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    // Saved-heart + login state are filled in client-side by the shared
    // watchlist store (WatchlistButton + WatchlistSync), so we skip both the
    // per-request watchlist round-trip AND the auth.getUser() here — the
    // catalogue render is now fully shareable + cacheable across users.
  } catch (err) {
    console.warn(
      "[/properties] feed unavailable:",
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
      loggedIn={false}
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
