import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

// Hard cap on how many auctions a single user can have on their
// watchlist. Without it, anyone (incl. abuse bots) could stuff the
// table with millions of rows — RLS by itself doesn't quota.
//
// 500 is generous for a human (the entire active catalogue fits) and
// trivial to raise if a power-user ever asks.
const WATCHLIST_LIMIT = 500;

/**
 * Toggle watchlist membership. POST adds, DELETE removes. Both are
 * idempotent — repeat POSTs return ok:true, repeat DELETEs return ok:true
 * even when the row doesn't exist. The user_id comes from the session;
 * RLS would reject inserts where user_id != auth.uid() anyway.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ auctionId: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { auctionId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  // Enforce the per-user cap. We check BEFORE the upsert so a user
  // toggling an already-saved item never blows up — we count current
  // rows; the upsert is idempotent so re-saving an existing row is a
  // no-op for the count.
  const { count: existingCount } = await supabase
    .from("watchlist")
    .select("auction_id", { count: "exact", head: true })
    .eq("user_id", user.id);
  // If this auction is already saved, the count is fine — re-saving
  // doesn't add a row. Otherwise we'd block the cap-th save.
  if ((existingCount ?? 0) >= WATCHLIST_LIMIT) {
    const { data: already } = await supabase
      .from("watchlist")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("auction_id", auctionId)
      .maybeSingle();
    if (!already) {
      return NextResponse.json(
        {
          error: "watchlist_full",
          detail: `Limite atteinte (${WATCHLIST_LIMIT} annonces). Retirez-en avant d'en ajouter d'autres.`,
        },
        { status: 409 },
      );
    }
  }

  const { error } = await supabase
    .from("watchlist")
    .upsert({ user_id: user.id, auction_id: auctionId }, { onConflict: "user_id,auction_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ auctionId: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { auctionId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("auction_id", auctionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: false });
}
