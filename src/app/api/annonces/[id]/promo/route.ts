import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { isUuid } from "@/lib/uuid";
import { apiTranslator } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";
import { canBuy, placementOf } from "@/lib/promo";
import { featureOff } from "@/lib/settings/gate";
import { paymentsClosed } from "@/lib/payments/server";

/**
 * POST /api/annonces/:id/promo  { product: "promo-accueil" | "promo-top-recherche" | "promo-banniere" }
 *
 * The seller buys a placement for their online annonce: this creates the
 * payment (kind « promo », the product's price read here, never from the
 * browser) and the browser goes to the usual checkout. The placement starts
 * when an admin accepts the receipt (/api/admin/paiements). One placement at a
 * time; the same one again extends it.
 *
 * « One at a time » covers what is waiting to be paid too: two placements
 * bought together were both paid, and accepting the second erased the first
 * (the three share one expiry). A placement of this annonce still waiting for
 * its receipt is the one offered again (the same product) or the reason the
 * other is refused. The table holds the same line for requests that cross
 * (payments_one_pending_promo, 0191): its refusal is read back as the row
 * that won.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_promos");
  if (off) return off;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  // Before anything is created: with no payee to pay, the checkout this leads
  // to can only say « indisponible », and the pending payment made here would
  // sit in « Mes paiements » with no way to pay it.
  const closed = await paymentsClosed();
  if (closed) return closed;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  const t = await apiTranslator(req, "promoApi");
  const locale = req.headers.get("referer")?.includes("/ar/") ? "ar" : "fr";

  const body = await jsonObject(req);
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

  // A placement of this annonce still waiting for its receipt, or for the
  // console: the same one is reused, never two; another one must wait.
  const waiting = async () => {
    const { data } = await admin
      .from("payments")
      .select("id, metadata")
      .eq("kind", "promo")
      .in("status", ["pending", "pending_review"])
      .contains("metadata", { listing_id: id })
      .order("created_at", { ascending: false })
      .limit(1);
    return (data?.[0] as { id: string; metadata: { product_id?: string } | null } | undefined) ?? null;
  };
  const answerFor = (p: { id: string; metadata: { product_id?: string } | null }) =>
    p.metadata?.product_id === product.id
      ? NextResponse.json({ ok: true, paymentId: p.id })
      : NextResponse.json({ error: "conflict", detail: t("pendingOther") }, { status: 409 });

  const existing = await waiting();
  if (existing) return answerFor(existing);

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
        // The quote, frozen: the console checks the receipt against it, not
        // against the price of the day (src/lib/payments/quoteCheck.ts).
        list_price: product.price,
        placement: column,
        duration_days: product.duration_days,
      },
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    // Two taps, or two tabs, at the same moment: the other one's row is the
    // placement in progress.
    const won = await waiting();
    if (won) return answerFor(won);
  }
  if (error || !created) return fail("promo_payment_failed", 500, error);
  logAction(req, user, "listing.promo", { id, product: slug, payment: created.id });
  return NextResponse.json({ ok: true, paymentId: created.id });
}
