import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

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
    .select("id, owner_id, status, listing_type")
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

  // Pull current prices.
  const { data: priceRows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "listing_fee_tnd",
      "listing_fee_offer_tnd",
      "promo_home_featured_tnd",
      "promo_top_listed_tnd",
      "promo_banner_tnd",
    ]);
  const priceMap = new Map<string, number>();
  for (const r of priceRows ?? []) {
    const v = r.value;
    const n = typeof v === "number" ? v : Number(v);
    priceMap.set(r.key as string, Number.isFinite(n) ? n : 0);
  }
  // Offers and auctions are priced separately by the admin. Default
  // offer fee falls back to the auction fee if the offer key is unset
  // (older deployments before migration 0028).
  const base = isOffer
    ? (priceMap.get("listing_fee_offer_tnd") ?? priceMap.get("listing_fee_tnd") ?? 0)
    : (priceMap.get("listing_fee_tnd") ?? 0);
  const homeFee = promos.home_featured ? (priceMap.get("promo_home_featured_tnd") ?? 0) : 0;
  const topFee  = promos.top_listed    ? (priceMap.get("promo_top_listed_tnd") ?? 0)    : 0;
  const bnrFee  = promos.banner        ? (priceMap.get("promo_banner_tnd") ?? 0)        : 0;
  const amount = Math.round((base + homeFee + topFee + bnrFee) * 100) / 100;
  if (amount <= 0) {
    return NextResponse.json(
      { error: "zero_amount", detail: "Le tarif est à 0 — paiement non requis." },
      { status: 400 },
    );
  }

  // Reuse an existing actionable payment row for this property + user.
  const { data: existing } = await admin
    .from("payments")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("property_id", propertyId)
    .eq("kind", "listing_fee")
    .in("status", ["pending", "pending_review"])
    .maybeSingle();

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
