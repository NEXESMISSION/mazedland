import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/watchlist
 *
 * Returns the caller's login state and the full set of saved ANNONCE ids.
 * Used by the client favourites store (src/lib/watchlistStore.ts) to fill in
 * hearts + login state on statically-rendered pages, where the server render
 * cannot read cookies. Anonymous callers get { loggedIn: false, ids: [] }.
 *
 * It returned `auction_id` until the auction product was deleted. The column
 * is still on the table (nullable, with a check that exactly one subject is
 * set) but nothing writes it any more, so filtering on a non-null listing_id
 * is both the correct query and a cheap guard against a stale auction row
 * sending an id the catalogue cannot resolve.
 *
 * Never cached — it's per-user. The page that calls it is the cached/static
 * surface; this little personalization fetch runs off the critical path.
 */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ loggedIn: false, ids: [] });

  const { data } = await supabase
    .from("watchlist")
    .select("listing_id")
    .eq("user_id", user.id)
    .not("listing_id", "is", null);

  return NextResponse.json({
    loggedIn: true,
    ids: (data ?? []).map((r) => r.listing_id as string),
  });
}
