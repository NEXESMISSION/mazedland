import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * Seller-initiated auction cancellation.
 *
 *   POST /api/auctions/[id]/cancel
 *
 * Allowed only when:
 *   - caller is the property owner
 *   - auction is in `scheduled` status (no bids could have landed yet)
 *   - OR auction is in `live`/`extending` with `bid_count = 0`
 *
 * Once any bid has been placed, the seller can't cancel unilaterally
 * because bidders are entitled to their auction. They have to escalate
 * to admin (who can still cancel via /admin/properties or a manual SQL).
 *
 * On success we flip `auctions.status` to 'cancelled', release any
 * deposits the seller might have accidentally locked themselves (none
 * by design, but defensive), and notify the seller that their listing
 * is back in the "ready" pool (no payment required to reschedule).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id: auctionId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  // Fetch + verify ownership in one round-trip.
  const { data: auction } = await supabase
    .from("auctions")
    .select(
      "id, status, property_id, property:properties (owner_id, title)",
    )
    .eq("id", auctionId)
    .single();
  if (!auction) {
    return NextResponse.json({ error: "auction_not_found" }, { status: 404 });
  }
  const ownerId = (auction as unknown as { property: { owner_id: string; title: string } }).property
    ?.owner_id;
  if (ownerId !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }

  // Atomic, race-safe cancel: cancel_auction_safe() locks the auction FOR
  // UPDATE, re-checks ownership + status + bid count INSIDE the lock, and
  // refuses ('has_bids') if any bid exists. Serializes against place_bid's
  // own FOR UPDATE, so a bid landing mid-cancel can no longer be stranded on a
  // cancelled lot (the old check-then-write TOCTOU). Runs as the user.
  const { error: cancelErr } = await supabase.rpc("cancel_auction_safe", {
    p_auction_id: auctionId,
  });
  if (cancelErr) {
    const msg = cancelErr.message ?? "";
    if (msg.includes("has_bids")) {
      return NextResponse.json(
        { error: "has_bids", detail: "L'enchère a reçu des offres. Contactez l'administration pour l'annuler." },
        { status: 409 },
      );
    }
    if (msg.includes("not_cancellable")) {
      return NextResponse.json(
        { error: "not_cancellable", detail: "L'enchère est déjà clôturée." },
        { status: 409 },
      );
    }
    const code = msg.includes("forbidden") ? 403
      : msg.includes("auction_not_found") ? 404
      : msg.includes("auth") ? 401 : 500;
    return NextResponse.json({ error: "cancel_failed" }, { status: code });
  }

  // Cancel committed. Notifications below are best-effort (service-role).
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ ok: true });
  }

  const title = (auction as unknown as { property: { title: string } }).property?.title;
  const propertyId = (auction as unknown as { property_id: string }).property_id;
  const titleClause = title ? `« ${title} »` : "votre annonce";

  // Notify the seller (echo back). Deep-linked to their listing detail
  // so they land where they can reschedule, not on a generic dashboard.
  await admin.rpc("enqueue_notification", {
    p_user_id: user.id,
    p_kind: "auction_cancelled",
    p_title: "Enchère annulée",
    p_body: title
      ? `Votre enchère pour ${titleClause} est annulée. Vous pouvez la reprogrammer depuis votre tableau de bord.`
      : "Votre enchère est annulée.",
    p_link: `/sell/${propertyId}`,
  });

  // Fan out to anyone who had this auction on their watchlist — the
  // bid-count gate guarantees no bidders to notify, but watchers had it
  // saved precisely so they wouldn't miss the start. Without this they
  // see the row vanish silently from /account/activity?tab=favoris.
  // Best-effort: failure to fan-out doesn't roll back the cancellation.
  const { data: watchers } = await admin
    .from("watchlist")
    .select("user_id")
    .eq("auction_id", auctionId);
  for (const w of watchers ?? []) {
    if ((w as { user_id: string }).user_id === user.id) continue;
    await admin.rpc("enqueue_notification", {
      p_user_id: (w as { user_id: string }).user_id,
      p_kind: "auction_cancelled",
      p_title: "Enchère annulée",
      p_body: title
        ? `L'enchère ${titleClause} que vous suiviez a été annulée par le vendeur.`
        : "Une enchère que vous suiviez a été annulée par le vendeur.",
      // Deep-link to the (now cancelled) detail page — the price card
      // shows "Enchère annulée" so the watcher sees the context. The
      // page's stale-target recovery sends them to /account/activity if
      // the row ever gets hard-deleted later.
      p_link: `/auctions/${auctionId}`,
    });
  }

  return NextResponse.json({ ok: true });
}
