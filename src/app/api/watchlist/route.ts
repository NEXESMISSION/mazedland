import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/watchlist
 *
 * Returns the caller's login state and the full set of saved auction ids.
 * Used by the client watchlist store (src/lib/watchlistStore.ts) to fill in
 * saved-hearts + login state on statically-rendered pages, where the server
 * render can't read cookies. Anonymous callers get { loggedIn: false, ids: [] }.
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
    .select("auction_id")
    .eq("user_id", user.id);

  return NextResponse.json({
    loggedIn: true,
    ids: (data ?? []).map((r) => r.auction_id as string),
  });
}
