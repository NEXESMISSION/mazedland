import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/explore/feed — the reels feed source.
 *
 * No filters, no pagination: returns a large batch of every browseable
 * listing in one shot. The client shuffles it, drops already-seen ids
 * (localStorage), and renders an endless TikTok-style feed. Kept dead
 * simple on purpose — the "smart" part (random order, no-repeat,
 * live-first weighting) lives client-side where the seen-set is.
 *
 * Also returns the caller's saved-auction ids so hearts paint filled.
 */
export async function GET(req: NextRequest) {
  const limit = clamp(Number(req.nextUrl.searchParams.get("limit") ?? 120), 1, 200);
  const supabase = await getServerSupabase();

  const { data, error } = await supabase
    .from("auctions")
    .select(
      `*, property:properties!inner (*, photos:property_photos (id, storage_path, sort_order, caption))`,
    )
    .in("status", ["scheduled", "live", "extending"])
    .eq("property.status", "ready")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []) as unknown as AuctionWithProperty[];

  let savedAuctionIds: string[] = [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && items.length > 0) {
    const { data: saves } = await supabase
      .from("watchlist")
      .select("auction_id")
      .eq("user_id", user.id)
      .in("auction_id", items.map((a) => a.id));
    savedAuctionIds = (saves ?? []).map((s) => s.auction_id as string);
  }

  return NextResponse.json({ items, savedAuctionIds });
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
