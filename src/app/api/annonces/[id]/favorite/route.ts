import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";

/**
 * Favourites for annonces.
 *
 *   POST   /api/annonces/[id]/favorite  → save
 *   DELETE /api/annonces/[id]/favorite  → unsave
 *
 * Written through the caller's own session, not the service role: RLS on
 * `watchlist` already says a row belongs to its user, and going around it here
 * would mean re-implementing that rule in application code — the kind of
 * duplication that drifts.
 */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { error } = await supabase
    .from("watchlist")
    .insert({ user_id: user.id, listing_id: id });

  // 23505 = already saved. Saving twice is what a double tap looks like, not an
  // error worth showing anyone.
  if (error && error.code !== "23505") {
    return fail("favorite_failed", 500, error);
  }
  return NextResponse.json({ ok: true, saved: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("listing_id", id);
  if (error) return fail("unfavorite_failed", 500, error);

  return NextResponse.json({ ok: true, saved: false });
}
