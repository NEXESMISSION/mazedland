import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { PRODUCT_SELECT, isFree, resolveListingFee, toProduct } from "@/lib/products";
import { liveListingCount, moderationSettings, publishOrQueue } from "@/lib/moderation/server";

/**
 * POST /api/annonces/[id]/renew — put an expired annonce back online.
 *
 * Expiry is what keeps the catalog honest (D2), so renewal is the other half of
 * that bargain: nothing is lost, and the annonce comes back.
 *
 * Same order as /submit, deliberately: free while the seller is within their
 * free places (0165), then a pack credit, then a payment. A renewal that is
 * settled goes through the same moderation decision as a new annonce — a
 * trusted seller's clean annonce is back online at once, anything else waits
 * for an admin.
 *
 * Priced by the `renewal` product when one is active, falling back to the
 * ordinary publication fee for that category — a renewal is a publication.
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
  const settle = async (paidWith: string, remaining?: number) => {
    const outcome = await publishOrQueue(admin, id, settings, counted);
    if (outcome.status === "error") return fail("listing_renew_failed", 500, outcome.error);
    logAction(req, user, `listing.renew.${paidWith}`, { id, remaining, status: outcome.status });
    return NextResponse.json({
      status: outcome.status,
      paidWith,
      remaining,
      ...(outcome.status === "published" ? { expires_at: outcome.expiresAt.toISOString() } : {}),
    });
  };

  // ── Within the free places ────────────────────────────────────────────────
  // The listing itself is expired, so it is not among the live ones counted.
  if ((await liveListingCount(admin, user.id, id)) < settings.freeLimit) {
    return settle("free_quota");
  }

  // ── A credit, if they hold one ────────────────────────────────────────────
  const { data: credited } = await admin.rpc("consume_listing_credit", {
    p_seller: user.id,
    p_listing: id,
    p_actor: user.id,
  });
  if (credited?.ok === true) {
    return settle("credit", credited.remaining as number);
  }

  // ── Otherwise it is paid for ──────────────────────────────────────────────
  const { data: prodRows } = await admin
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true);
  const products = (prodRows ?? []).map((r) => toProduct(r as Parameters<typeof toProduct>[0]));

  const { data: cat } = await admin
    .from("categories")
    .select("parent_id")
    .eq("id", listing.category_id as string)
    .maybeSingle();
  const categoryFee = resolveListingFee(
    products,
    listing.category_id as string,
    (cat?.parent_id as string | null) ?? null,
  );

  // A dedicated renewal price if the admin set one; otherwise the ordinary
  // publication fee for this category, because that is what a renewal is.
  // Exception first: a category that publishes for free renews for free.
  // Charging 15 TND to keep a free annonce alive would be a trap.
  const renewal = isFree(categoryFee)
    ? categoryFee
    : products.find((p) => p.kind === "renewal") ?? categoryFee;
  if (!renewal) return fail("no_price_configured", 503);

  if (renewal.price <= 0) return settle("free");

  const { data: existing } = await admin
    .from("payments")
    .select("id")
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
        amount: renewal.price,
        status: "pending",
        metadata: {
          listing_id: id,
          product_id: renewal.id,
          product_slug: renewal.slug,
          duration_days: renewal.durationDays,
          renewal: true,
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
    .update({
      status: "pending_payment",
      fee_payment_id: paymentId,
      ...counted,
    })
    .eq("id", id);

  logAction(req, user, "listing.renew.payment", { id, paymentId, amount: renewal.price });
  return NextResponse.json({
    status: "pending_payment",
    paidWith: "payment",
    paymentId,
    amount: renewal.price,
  });
}
