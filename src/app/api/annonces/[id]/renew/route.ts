import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { liveListingCount, moderationSettings, publishOrQueue } from "@/lib/moderation/server";

/**
 * POST /api/annonces/[id]/renew — put an expired annonce back online.
 *
 * Expiry is what keeps the catalog honest (D2), so renewal is the other half of
 * that bargain: nothing is lost, and the annonce comes back.
 *
 * Same order as /submit, deliberately: free while the seller is within their
 * free places (0165), then a pack credit, and past that it is refused with
 * `free_limit_reached` — there is no fee per annonce any more, more annonces
 * is what Mazed Immo Pro is for. A renewal that is settled goes through the
 * same moderation decision as a new annonce — a trusted seller's clean annonce
 * is back online at once, anything else waits for an admin.
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
    .select("id, seller_id, category_id, status, title, contact_phone, renewed_count")
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  if (listing.seller_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }

  // Only something that has actually come down can be renewed. A live listing
  // renewing itself would be paying twice for one publication.
  if (!["expired", "archived", "sold", "rented"].includes(listing.status as string)) {
    const t = await apiTranslator(req, "accountApi.renew");
    return NextResponse.json(
      { error: "not_renewable", detail: t("notRenewable") },
      { status: 409 },
    );
  }
  if (!listing.contact_phone) {
    const t = await apiTranslator(req, "accountApi.renew");
    return NextResponse.json(
      { error: "contact_required", detail: t("contactRequired") },
      { status: 400 },
    );
  }

  const settings = await moderationSettings(admin);
  const counted = { renewed_count: (listing.renewed_count as number) + 1 };

  /** Settled: let the rules decide whether it goes straight back online. */
  const settle = async (paidWith: string, more: { remaining?: number; freeLeft?: number } = {}) => {
    const outcome = await publishOrQueue(admin, id, settings, counted);
    if (outcome.status === "error") return fail("listing_renew_failed", 500, outcome.error);
    logAction(req, user, `listing.renew.${paidWith}`, { id, ...more, status: outcome.status });
    return NextResponse.json({
      status: outcome.status,
      paidWith,
      ...more,
      freeLimit: settings.freeLimit,
      ...(outcome.status === "published" ? { expires_at: outcome.expiresAt.toISOString() } : {}),
    });
  };

  // ── Within the free places ────────────────────────────────────────────────
  // The listing itself is expired, so it is not among the live ones counted.
  const live = await liveListingCount(admin, user.id, id);
  if (live < settings.freeLimit) {
    return settle("free_quota", { freeLeft: settings.freeLimit - live - 1 });
  }

  // ── A credit, if they hold one ────────────────────────────────────────────
  const { data: credited } = await admin.rpc("consume_listing_credit", {
    p_seller: user.id,
    p_listing: id,
    p_actor: user.id,
  });
  if (credited?.ok === true) {
    return settle("credit", { remaining: credited.remaining as number });
  }

  // ── The free places are full ──────────────────────────────────────────────
  const t = await apiTranslator(req, "publishApi");
  logAction(req, user, "listing.renew.free_limit", { id, live, limit: settings.freeLimit });
  return NextResponse.json(
    {
      error: "free_limit_reached",
      freeLimit: settings.freeLimit,
      detail: t("freeLimitReached", { limit: settings.freeLimit }),
    },
    { status: 402 },
  );
}
