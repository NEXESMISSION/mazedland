import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/my-deposits
 *
 * Returns the caller's login state and the set of auction ids they hold an
 * ACTIVE caution on (deposit paid, not yet released or forfeited) — i.e. the
 * auctions they're cleared to bid on. Used by the client deposit store
 * (src/lib/depositStore.ts) so an auction card can surface a "Enchérir"
 * shortcut straight to the bid page on statically-rendered surfaces, where
 * the server render can't read cookies. Anonymous → { loggedIn: false, ids: [] }.
 *
 * Never cached — per-user, off the critical path (the page that calls it is
 * the cached/static surface).
 */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ loggedIn: false, ids: [] });

  const { data } = await supabase
    .from("auction_deposits")
    .select("auction_id")
    .eq("user_id", user.id)
    .is("released_at", null)
    .is("forfeited_at", null);

  const ids = Array.from(
    new Set((data ?? []).map((r) => r.auction_id as string).filter(Boolean)),
  );
  return NextResponse.json({ loggedIn: true, ids });
}
