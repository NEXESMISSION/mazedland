import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { PRODUCT_SELECT, isFree, resolveListingFee, toProduct } from "@/lib/products";

/**
 * POST /api/annonces/[id]/renew — put an expired annonce back online.
 *
 * Expiry is what keeps the catalog honest (D2), so renewal is the other half of
 * that bargain: nothing is lost, the seller just pays again — or spends a pack
 * credit — and the listing goes back through the queue.
 *
 * It follows the same order as /submit, deliberately: credit first, payment
 * otherwise, and NEVER straight to published. A renewed listing is re-checked,
 * because the reason it is worth paying for is that someone looks at it.
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
  if (!["expired", "archived", "sold"].includes(listing.status as string)) {
    return NextResponse.json(
      {
        error: "not_renewable",
        detail: "Cette annonce est encore en ligne ou en cours de traitement.",
      },
      { status: 409 },
    );
  }
  if (!listing.contact_phone) {
    return NextResponse.json(
      { error: "contact_required", detail: "Ajoutez un numéro joignable avant de renouveler." },
      { status: 400 },
    );
  }

  // ── A credit, if they hold one ────────────────────────────────────────────
  const { data: credited } = await admin.rpc("consume_listing_credit", {
    p_seller: user.id,
    p_listing: id,
    p_actor: user.id,
  });

  if (credited?.ok === true) {
    await admin
      .from("listings")
      .update({
        status: "pending_review",
        rejection_reason: null,
        renewed_count: (listing.renewed_count as number) + 1,
      })
      .eq("id", id);

    logAction(req, user, "listing.renew.credit", { id, remaining: credited.remaining });
    return NextResponse.json({
      status: "pending_review",
      paidWith: "credit",
      remaining: credited.remaining,
    });
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

  if (renewal.price <= 0) {
    const { error } = await admin
      .from("listings")
      .update({
        status: "pending_review",
        rejection_reason: null,
        renewed_count: (listing.renewed_count as number) + 1,
      })
      .eq("id", id);
    if (error) return fail("listing_renew_failed", 500, error);

    logAction(req, user, "listing.renew.free", { id, productSlug: renewal.slug });
    return NextResponse.json({ status: "pending_review", paidWith: "free" });
  }

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
      renewed_count: (listing.renewed_count as number) + 1,
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
