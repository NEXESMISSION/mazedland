import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { PRODUCT_SELECT, resolveListingFee, toProduct } from "@/lib/products";

/**
 * POST /api/annonces/[id]/submit — send a draft listing for publication.
 *
 * This is the one place that decides how a publication is paid for, and it
 * decides server-side because the client must never get a vote on price:
 *
 *   1. The seller holds a pack with quota left  → spend one credit, straight to
 *      the moderation queue, no payment step.
 *   2. Otherwise                                → create a `listing_fee` payment
 *      for THIS category's price and hand back the id, so the browser can go to
 *      /payment/checkout and upload a receipt. The listing waits in
 *      `pending_payment` until an admin captures it.
 *
 * Returns { status: "pending_review" } or { status: "pending_payment", paymentId }.
 *
 * Publication itself never happens here — `_listings_guard_publish` (0146)
 * refuses any status jump to 'published' that isn't the admin/service path, so
 * a forged request can reach the queue at worst, never the catalogue.
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

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, category_id, status, title, contact_phone, seller_attestation_version")
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  if (listing.seller_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }

  // Only a draft (or a listing that came back rejected, or one whose payment
  // was abandoned) may be submitted. Re-submitting something already in the
  // queue would spend a second credit for one publication.
  const submittable = ["draft", "rejected", "pending_payment"];
  if (!submittable.includes(listing.status as string)) {
    return NextResponse.json(
      { error: "not_submittable", detail: `Cette annonce est déjà « ${listing.status} ».` },
      { status: 409 },
    );
  }

  // Two things a listing cannot go live without, checked before any money moves.
  if (!listing.contact_phone) {
    return NextResponse.json(
      { error: "contact_required", detail: "Ajoutez un numéro de téléphone joignable." },
      { status: 400 },
    );
  }
  if (!listing.seller_attestation_version) {
    return NextResponse.json(
      { error: "attestation_required", detail: "Cochez l'attestation sur l'honneur." },
      { status: 400 },
    );
  }

  const { count: photoCount } = await admin
    .from("listing_photos")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", id);
  if ((photoCount ?? 0) === 0) {
    return NextResponse.json(
      { error: "photo_required", detail: "Ajoutez au moins une photo." },
      { status: 400 },
    );
  }

  // ── 1. A pack credit, if they have one ────────────────────────────────────
  const { data: credited } = await admin.rpc("consume_listing_credit", {
    p_seller: user.id,
    p_listing: id,
    p_actor: user.id,
  });

  if (credited?.ok === true) {
    await admin
      .from("listings")
      .update({ status: "pending_review", rejection_reason: null })
      .eq("id", id);

    await admin
      .rpc("enqueue_notification", {
        p_user_id: user.id,
        p_kind: "listing_submitted",
        p_title: "Annonce envoyée à la vérification",
        p_body: `« ${listing.title} » est en cours de vérification. Il vous reste ${credited.remaining} publication(s).`,
        p_link: "/account/listings",
      })
      .then(() => {}, () => {});

    logAction(req, user, "listing.submit.credit", { id, remaining: credited.remaining });
    return NextResponse.json({
      status: "pending_review",
      paidWith: "credit",
      remaining: credited.remaining,
    });
  }

  // ── 2. Otherwise it is paid for, at this category's price ─────────────────
  const { data: prodRows } = await admin
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true);
  const products = (prodRows ?? []).map((r) => toProduct(r as Parameters<typeof toProduct>[0]));
  // The parent category too, so a price set on « Terrains » covers every one of
  // its sub-categories without repeating the number on each.
  const { data: cat } = await admin
    .from("categories")
    .select("parent_id")
    .eq("id", listing.category_id as string)
    .maybeSingle();

  const fee = resolveListingFee(
    products,
    listing.category_id as string,
    (cat?.parent_id as string | null) ?? null,
  );

  if (!fee) {
    // No price configured is NOT "free" — it is a misconfiguration, and
    // publishing for nothing would be a silent revenue hole.
    return fail("no_price_configured", 503);
  }

  // ── 2a. Priced at zero: free on purpose ───────────────────────────────────
  // Nothing is priced at zero on Batta today, but the case must be handled
  // before it is: a payment row for 0 TND would send the seller to a checkout
  // to upload a receipt for nothing, and leave the annonce stuck in
  // `pending_payment` waiting for an admin to capture an empty payment. A free
  // introductory category is a pricing decision away, and it should not need a
  // deploy.
  if (fee.price <= 0) {
    const { error } = await admin
      .from("listings")
      .update({ status: "pending_review", rejection_reason: null })
      .eq("id", id);
    if (error) return fail("listing_submit_failed", 500, error);

    await admin
      .rpc("enqueue_notification", {
        p_user_id: user.id,
        p_kind: "listing_submitted",
        p_title: "Annonce envoyée à la vérification",
        p_body: `« ${listing.title} » est en cours de vérification. La publication est gratuite dans cette catégorie.`,
        p_link: "/account/listings",
      })
      .then(() => {}, () => {});

    logAction(req, user, "listing.submit.free", { id, productSlug: fee.slug });
    return NextResponse.json({ status: "pending_review", paidWith: "free" });
  }

  // Reuse an actionable payment so a double-submit can't create two.
  const { data: existing } = await admin
    .from("payments")
    .select("id, amount")
    .eq("user_id", user.id)
    .eq("kind", "listing_fee")
    .in("status", ["pending", "pending_review"])
    .contains("metadata", { listing_id: id })
    .limit(1);

  let paymentId = existing?.[0]?.id as string | undefined;

  if (!paymentId) {
    const { data: created, error } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        kind: "listing_fee",
        provider: "bank_transfer",
        amount: fee.price,
        status: "pending",
        metadata: {
          listing_id: id,
          product_id: fee.id,
          product_slug: fee.slug,
          duration_days: fee.durationDays,
          initiated_at: new Date().toISOString(),
        },
      })
      .select("id")
      .single();
    if (error || !created) return fail("payment_create_failed", 500, error);
    paymentId = created.id as string;
  }

  await admin
    .from("listings")
    .update({ status: "pending_payment", fee_payment_id: paymentId, rejection_reason: null })
    .eq("id", id);

  logAction(req, user, "listing.submit.payment", { id, paymentId, amount: fee.price });
  return NextResponse.json({
    status: "pending_payment",
    paidWith: "payment",
    paymentId,
    amount: fee.price,
  });
}
