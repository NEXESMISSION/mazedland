import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";

// Explicit auction columns — NOT `*`. This fetch uses the service-role client
// (to be cacheable), which BYPASSES the 0112 column-grant lockdown, so we must
// omit reserve_price here too or it would be serialized into the client
// hydration payload. (Mirrors the safe column set granted in 0112.)
const DETAIL_SELECT = `
  id, property_id, type, opening_price,
  dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
  starts_at, ends_at, extend_window_seconds, extend_by_seconds,
  status, current_price, sixth_offer_deadline,
  winner_user_id, winner_amount, hammer_at, created_at, updated_at,
  listing_type, sale_price, sale_negotiable, buy_now_price,
  final_payment_due_at, relisted_from_id, bid_count,
  property:properties (
    *,
    photos:property_photos (id, storage_path, sort_order, caption)
  )
`;

/**
 * Public auction-detail shell (auction + property + photos), cached 15s and
 * shared across ALL viewers via the cookieless service-role client.
 *
 * The auction detail page is the single highest-traffic surface, and its
 * expensive property-join was uncached — every anonymous viewer of a hot lot
 * triggered a fresh DB round-trip for byte-identical output (unlike home/explore
 * which are cached). This caches that public shell.
 *
 * Excludes 'cancelled' lots so the cache matches public RLS visibility
 * (auctions_public_read = non-cancelled OR admin). The page falls back to a
 * per-user RLS-scoped fetch on a miss, so the OWNER still sees their own
 * cancelled auction and a non-owner still gets RLS-null → the existing
 * recovery/redirect. Per-user bits (deposit, isOwner, watchlist) are fetched
 * live by the page, never from here, so they're never stale.
 *
 * 15s revalidate is well under tick's 1-min cadence; live price/status moves are
 * corrected client-side by the realtime subscription, so a brief stale figure on
 * first paint is cosmetic (the bid path always re-reads server-side via the RPC).
 */
export const getPublicAuctionDetail = unstable_cache(
  async (id: string) => {
    const sb = getServiceSupabase();
    if (!sb) return null;
    const { data } = await sb
      .from("auctions")
      .select(DETAIL_SELECT)
      .eq("id", id)
      .neq("status", "cancelled")
      .maybeSingle();
    return data ?? null;
  },
  ["auction-detail"],
  { revalidate: 15, tags: ["auction-detail"] },
);
