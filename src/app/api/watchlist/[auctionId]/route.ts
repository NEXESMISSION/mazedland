import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

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
