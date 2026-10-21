import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { PRODUCT_SELECT, resolveListingFee, toProduct } from "@/lib/products";
import { apiTranslator } from "@/lib/i18n/server";
import { liveListingCount, moderationSettings, publishOrQueue } from "@/lib/moderation/server";

/**
 * POST /api/annonces/[id]/submit — send a draft listing for publication.
 *
 * This is the one place that decides how a publication is paid for, and it
 * decides server-side because the client must never get a vote on price:
 *
 *   0. Its fee was already captured (a rejected annonce coming back) → settled.
 *   1. The seller has fewer than `free_listing_limit` annonces live (0165)
 *                                               → free.
 *   2. The seller holds a pack with quota left  → spend one credit.
 *   3. Otherwise                                → a `listing_fee` payment for
 *      THIS category's price; the browser goes to /payment/checkout to upload a
 *      receipt, and the listing waits in `pending_payment` until it is captured.
 *
 * Once settled (0–2, or a category priced at zero), the moderation rules decide:
 * a trusted seller's annonce that passes every rule is published on the spot,
 * anything else goes to the admin queue with its reasons (`review_flags`).
 *
 * Returns { status: "published" }, { status: "pending_review" } or
 * { status: "pending_payment", paymentId }.
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
    .select("id, seller_id, category_id, status, title, contact_phone, seller_attestation_version, fee_payment_id")
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
    const t = await apiTranslator(req, "publishApi");
    // The status in words: the raw enum (« pending_review ») is not a sentence
    // a seller can read, in either language.
    const status = String(listing.status);
    const label = t.has(`statuses.${status}`) ? t(`statuses.${status}`) : status;
    return NextResponse.json(
      { error: "not_submittable", detail: t("notSubmittable", { status: label }) },
      { status: 409 },
    );
  }

  // Two things a listing cannot go live without, checked before any money moves.
  if (!listing.contact_phone) {
    const t = await apiTranslator(req, "publishApi");
    return NextResponse.json(
      { error: "contact_required", detail: t("contactRequired") },
      { status: 400 },
    );
  }
  if (!listing.seller_attestation_version) {
    const t = await apiTranslator(req, "publishApi");
    return NextResponse.json(
      { error: "attestation_required", detail: t("attestationRequired") },
      { status: 400 },
    );
  }

  const { count: photoCount } = await admin
    .from("listing_photos")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", id);
  if ((photoCount ?? 0) === 0) {
    const t = await apiTranslator(req, "publishApi");
    return NextResponse.json(
      { error: "photo_required", detail: t("photoRequired") },
      { status: 400 },
    );
  }

  const settings = await moderationSettings(admin);
  let paidWith: "already_paid" | "free_quota" | "credit" | "free";
  let remaining: number | undefined;

  // ── 0. A fee that was already captured ────────────────────────────────────
  // A rejected annonce keeps its `fee_payment_id`. Re-submitting it ran the
  // pricing path again and created a SECOND payment for one publication.
  let alreadyPaid = false;
  if (listing.fee_payment_id) {
    const { data: paid } = await admin
      .from("payments")
      .select("status")
      .eq("id", listing.fee_payment_id as string)
      .maybeSingle();
    alreadyPaid = paid?.status === "captured";
  }

  if (alreadyPaid) {
    paidWith = "already_paid";
  } else if ((await liveListingCount(admin, user.id, id)) < settings.freeLimit) {
    // ── 1. Within the free places ───────────────────────────────────────────
    // An individual publishes for free while they have fewer than
    // `free_listing_limit` annonces live. Beyond that comes a credit or the
    // fee — which is how an agency with thirty annonces pays without anyone
    // having to decide who is an agency.
    paidWith = "free_quota";
  } else {
    // ── 2. A pack credit, if they have one ──────────────────────────────────
    const { data: credited } = await admin.rpc("consume_listing_credit", {
      p_seller: user.id,
      p_listing: id,
      p_actor: user.id,
    });

    if (credited?.ok === true) {
      paidWith = "credit";
      remaining = credited.remaining as number;
    } else {
      // ── 3. Otherwise it is paid for, at this category's price ───────────
      const { data: prodRows } = await admin
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("is_active", true);
      const products = (prodRows ?? []).map((r) => toProduct(r as Parameters<typeof toProduct>[0]));
      // The parent category too, so a price set on « Terrains » covers every one
      // of its sub-categories without repeating the number on each.
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

      if (fee.price > 0) {
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

      // Priced at zero: free on purpose. A payment row for 0 TND would send the
      // seller to a checkout to upload a receipt for nothing.
      paidWith = "free";
    }
  }

  // ── The moderation decision ────────────────────────────────────────────────
  const outcome = await publishOrQueue(admin, id, settings);
  if (outcome.status === "error") return fail("listing_submit_failed", 500, outcome.error);

  if (outcome.status === "published") {
    // publishListing has told the seller it is online.
    logAction(req, user, "listing.submit.auto_published", { id, paidWith });
    return NextResponse.json({
      status: "published",
      paidWith,
      remaining,
      expires_at: outcome.expiresAt.toISOString(),
    });
  }

  const variant =
    paidWith === "already_paid" ? "paid" : paidWith === "free_quota" ? "freeQuota" : paidWith;
  const body = {
    paid: `« ${listing.title} » est en cours de vérification. Les frais de publication étaient déjà réglés.`,
    credit: `« ${listing.title} » est en cours de vérification. Il vous reste ${remaining} publication(s).`,
    free: `« ${listing.title} » est en cours de vérification. La publication est gratuite dans cette catégorie.`,
    freeQuota: `« ${listing.title} » est en cours de vérification. Votre publication est gratuite.`,
  }[variant];

  await admin
    .rpc("enqueue_notification", {
      p_user_id: user.id,
      p_kind: "listing_submitted",
      p_title: "Annonce envoyée à la vérification",
      p_body: body,
      p_link: "/account/listings",
      p_payload: { vars: { title: listing.title, variant, ...(remaining !== undefined ? { remaining } : {}) } },
    })
    .then(() => {}, () => {});

  logAction(req, user, `listing.submit.${paidWith}`, { id, flags: outcome.flags, remaining });
  return NextResponse.json({ status: "pending_review", paidWith, remaining, flags: outcome.flags });
}
