import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { moderationSettings, publishOrQueue } from "@/lib/moderation/server";
import { coverPlace } from "@/lib/places/server";

/**
 * POST /api/annonces/[id]/submit — send a draft listing for publication.
 *
 * This is the one place that decides whether a publication is covered, and it
 * decides server-side because the client must never get a vote on it:
 *
 *   0. Its fee was already captured (an annonce from the days of the 15 TND
 *      fee coming back)                         → settled.
 *   1. An agence's annonce, while the agence's plan has room (0173), or any
 *      annonce of an agence owner whose plan has room → the plan.
 *   2. An account without a plan, with fewer than `free_listing_limit`
 *      annonces live (0165)                    → free.
 *   3. The seller holds a pack with quota left  → spend one credit.
 *   4. Otherwise                                → refused, `free_limit_reached`.
 *
 * Steps 1–3 are coverPlace (src/lib/places/server.ts), shared with renew and
 * relist so that every way back online counts places the same way.
 *
 * There is no fee per annonce any more. Every account publishes its free
 * places, and more than that is what Mazed Immo Pro is for: a shop and its
 * monthly plan. The annonce stays as it is (a draft, usually) until a place
 * frees up or the seller publishes it for their shop.
 *
 * Once settled, the moderation rules decide: a trusted seller's annonce that
 * passes every rule is published on the spot, anything else goes to the admin
 * queue with its reasons (`review_flags`).
 *
 * Returns { status: "published" } or { status: "pending_review" }, with
 * `freeLeft` when a free place paid for it, so the seller is told how many
 * remain.
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
    .select("id, seller_id, category_id, status, title, contact_phone, seller_attestation_version, fee_payment_id, shop_id")
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
  let paidWith: "already_paid" | "free_quota" | "credit" | "subscription";
  let remaining: number | undefined;
  /** Free places still open once this one is taken. */
  let freeLeft: number | undefined;

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
  } else {
    // An agence's plan, the free places, or a credit (src/lib/places): every
    // account publishes for free while it has fewer than `free_listing_limit`
    // annonces live — which is how an agency with thirty annonces ends up on a
    // Pro plan without anyone deciding who is an agency.
    const cover = await coverPlace(
      admin,
      { userId: user.id, listingId: id, shopId: (listing.shop_id as string | null) ?? null },
      settings.freeLimit,
    );
    if (!cover) {
      // ── 4. Nothing covers it ──────────────────────────────────────────────
      const t = await apiTranslator(req, "publishApi");
      logAction(req, user, "listing.submit.free_limit", { id, limit: settings.freeLimit });
      return NextResponse.json(
        {
          error: "free_limit_reached",
          freeLimit: settings.freeLimit,
          detail: t("freeLimitReached", { limit: settings.freeLimit }),
        },
        { status: 402 },
      );
    }
    paidWith = cover.via;
    if (cover.via === "free_quota") freeLeft = cover.left;
    else remaining = cover.left;
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
      freeLeft,
      freeLimit: settings.freeLimit,
      expires_at: outcome.expiresAt.toISOString(),
    });
  }

  const variant =
    paidWith === "already_paid" ? "paid" : paidWith === "free_quota" ? "freeQuota" : paidWith;
  const body = {
    paid: `« ${listing.title} » est en cours de vérification. Les frais de publication étaient déjà réglés.`,
    credit: `« ${listing.title} » est en cours de vérification. Il vous reste ${remaining} publication(s).`,
    freeQuota: `« ${listing.title} » est en cours de vérification. Votre publication est gratuite.`,
    subscription: `« ${listing.title} » est en cours de vérification. Elle compte dans l'abonnement de votre agence.`,
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
  return NextResponse.json({
    status: "pending_review",
    paidWith,
    remaining,
    freeLeft,
    freeLimit: settings.freeLimit,
    flags: outcome.flags,
  });
}
