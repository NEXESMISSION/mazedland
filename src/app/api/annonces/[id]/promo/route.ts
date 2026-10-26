import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { canBuy, placementOf } from "@/lib/promo";
import { featureOff } from "@/lib/settings/gate";

/**
 * POST /api/annonces/:id/promo  { product: "promo-accueil" | "promo-top-recherche" | "promo-banniere" }
 *
 * The seller buys a placement for their online annonce: this creates the
 * payment (kind « promo », the product's price read here, never from the
 * browser) and the browser goes to the usual checkout. The placement starts
 * when an admin accepts the receipt (/api/admin/paiements). One placement at a
 * time; the same one again extends it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_promos");
  if (off) return off;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const t = await apiTranslator(req, "promoApi");
  const locale = req.headers.get("referer")?.includes("/ar/") ? "ar" : "fr";

  const body = (await req.json().catch(() => ({}))) as { product?: unknown };
  const slug = typeof body.product === "string" ? body.product : "";
  const column = placementOf(slug);
  if (!column) return NextResponse.json({ error: "invalid", detail: t("product") }, { status: 400 });

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, title, promo_home_featured, promo_top_listed, promo_banner, promo_expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.seller_id !== user.id) return NextResponse.json({ error: "not_owner" }, { status: 403 });
  if (listing.status !== "published") return NextResponse.json({ error: "conflict", detail: t("notOnline") }, { status: 409 });
  if (!canBuy(listing, column)) {
    return NextResponse.json(
      { error: "conflict", detail: t("oneAtATime", { date: formatDate(listing.promo_expires_at as string, locale, "medium") }) },
      { status: 409 },
    );
  }

  const { data: product } = await admin
    .from("products")
    .select("id, slug, price, duration_days, name_fr")
    .eq("slug", slug)
    .eq("kind", "promo")
    .eq("is_active", true)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: "invalid", detail: t("product") }, { status: 400 });

  // The same placement already waiting for a receipt: reuse it, never two.
  const { data: existing } = await admin
    .from("payments")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", "promo")
    .in("status", ["pending", "pending_review"])
    .contains("metadata", { listing_id: id, product_id: product.id })
    .limit(1);
  if (existing && existing.length > 0) return NextResponse.json({ ok: true, paymentId: existing[0].id });

  const { data: created, error } = await admin
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "promo",
      provider: "bank_transfer",
      amount: product.price,
      status: "pending",
      metadata: {
        listing_id: id,
        product_id: product.id,
        product_slug: product.slug,
        placement: column,
        duration_days: product.duration_days,
      },
    })
    .select("id")
    .single();
  if (error || !created) return fail("promo_payment_failed", 500, error);
  logAction(req, user, "listing.promo", { id, product: slug, payment: created.id });
  return NextResponse.json({ ok: true, paymentId: created.id });
}
