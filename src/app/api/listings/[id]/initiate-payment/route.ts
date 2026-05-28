import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { parseMonetizationSettings, resolveListingFee } from "@/lib/pricing";

/**
 * POST /api/listings/[id]/initiate-payment
 *
 * Body: { promos: { home_featured?: boolean, top_listed?: boolean, banner?: boolean } }
 *
 * Creates a `listing_fee` payment row tied to the given property:
 *   - Re-fetches the latest tunable prices from app_settings.
 *   - Verifies the caller owns the property.
 *   - Computes amount = base + selected promos.
 *   - Reuses any existing actionable payment (pending / pending_review)
 *     for this property+user so a double-submit doesn't create duplicates.
 *   - Returns { paymentId } so the client can redirect to /payment/checkout?payment=<id>.
 *
 * No receipt upload here — that happens on the checkout page using the
 * existing /api/payments/[id]/receipt flow.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id: propertyId } = await ctx.params;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  // Ownership check — the user can only initiate payment for their own listings.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, owner_id, status, listing_type, sale_price")
    .eq("id", propertyId)
    .single();
  if (!prop || prop.owner_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  // Trust the DB row, not the client body — the user could lie about
  // listing_type to pay the cheaper fee. The SellForm just-inserted row
  // is authoritative.
  const isOffer = prop.listing_type === "direct";

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const promosIn = (body.promos ?? {}) as Record<string, unknown>;
  const promos = {
    home_featured: !!promosIn.home_featured,
    top_listed: !!promosIn.top_listed,
    banner: !!promosIn.banner,
  };

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Resolve the authoritative fee from the admin's monetization settings.
  const { data: priceRows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "fee_listing_auction", "fee_listing_direct",
      "promo_home", "promo_top", "promo_banner",
    ]);
  const map = new Map<string, unknown>();
  for (const r of priceRows ?? []) map.set(r.key as string, r.value);
  const mon = parseMonetizationSettings(map);

  // Direct-offer fees can be a % of the sale price; auctions can't (no
  // price yet) so they resolve to free/fixed only.
  const salePrice = isOffer ? Number(prop.sale_price ?? 0) || null : null;
  const base = resolveListingFee(isOffer ? mon.feeListingDirect : mon.feeListingAuction, salePrice);
  // Only count promos the admin left enabled.
  const homeFee = promos.home_featured && mon.promoHome.enabled ? mon.promoHome.value : 0;
  const topFee  = promos.top_listed    && mon.promoTop.enabled  ? mon.promoTop.value  : 0;
  const bnrFee  = promos.banner        && mon.promoBanner.enabled ? mon.promoBanner.value : 0;
  const amount = Math.round((base + homeFee + topFee + bnrFee) * 100) / 100;

  // Free posting (admin set it so, or all options off) → no payment. The
  // listing is already pending_review; admins were notified by the
  // properties trigger. Send the seller a submission ack (parity with the
  // paid path) and tell the client to show success, not checkout.
  if (amount <= 0) {
    await admin.rpc("enqueue_notification", {
      p_user_id: user.id,
      p_kind: "listing_submitted",
      p_title: "Annonce soumise",
      p_body: "Votre annonce est en cours de validation par l'équipe. Vous serez notifié(e) dès qu'elle est publiée.",
      p_link: `/sell/${propertyId}`,
    });
    return NextResponse.json({ free: true });
  }

  // Reuse an existing actionable payment row for this property + user.
  // limit(1) (not maybeSingle, which throws on >1 and would spawn dupes).
  const { data: existingRows } = await admin
    .from("payments")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("property_id", propertyId)
    .eq("kind", "listing_fee")
    .in("status", ["pending", "pending_review"])
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = existingRows?.[0];

  if (existing) {
    // Refresh amount + promo selection in case the user changed their picks.
    await admin
      .from("payments")
      .update({
        amount,
        metadata: {
          promos,
          listing_type: isOffer ? "direct" : "auction",
          base_fee: base,
          home_featured_fee: homeFee,
          top_listed_fee: topFee,
          banner_fee: bnrFee,
          updated_at: new Date().toISOString(),
        },
      })
      .eq("id", existing.id);
    return NextResponse.json({ paymentId: existing.id, amount });
  }

  const { data: created, error: insErr } = await admin
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "listing_fee",
      provider: "bank_transfer",
      amount,
      property_id: propertyId,
      status: "pending",
      metadata: {
        promos,
        listing_type: isOffer ? "direct" : "auction",
        base_fee: base,
        home_featured_fee: homeFee,
        top_listed_fee: topFee,
        banner_fee: bnrFee,
        initiated_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();
  if (insErr || !created) {
    // Lost a concurrent create race: the partial unique index
    // (payments_one_active_property) rejected our duplicate. Re-fetch the
    // row the winning request inserted and return it instead of a raw 500.
    if (insErr && /duplicate|unique/i.test(insErr.message)) {
      const { data: raceRows } = await admin
        .from("payments")
        .select("id")
        .eq("user_id", user.id)
        .eq("property_id", propertyId)
        .eq("kind", "listing_fee")
        .in("status", ["pending", "pending_review"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (raceRows?.[0]) return NextResponse.json({ paymentId: raceRows[0].id, amount });
    }
    return NextResponse.json({ error: insErr?.message ?? "insert_failed" }, { status: 500 });
  }

  // Submission receipt to the seller. Listing-fee accept/reject already
  // enqueue their own notifications later via the SQL RPC.
  await admin.rpc("enqueue_notification", {
    p_user_id: user.id,
    p_kind: "listing_submitted",
    p_title: "Annonce soumise",
    p_body: `Téléversez votre reçu (${amount.toFixed(2)} TND) pour publier votre annonce. L'équipe la validera ensuite.`,
    p_link: `/payment/checkout?payment=${created.id}`,
  });

  return NextResponse.json({ paymentId: created.id, amount });
}
