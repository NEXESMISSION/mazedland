import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { initiatePayment } from "@/lib/payments";
import { isSameOrigin } from "@/lib/sameOrigin";
import type { PaymentProvider } from "@/lib/payments/types";

/**
 * Unified buy-now / direct-sale purchase endpoint.
 *
 * Handles both:
 *   - listing_type='auction' with a buy_now_price set — buyer skips the
 *     bidding and pays the buy-now price (payment kind = 'buy_now')
 *   - listing_type='direct' — buyer pays the sale_price; there was no
 *     bidding to begin with (payment kind = 'buy_now' too, since
 *     semantically it's the same one-shot purchase)
 *
 * The atomic auction close happens server-side via the
 * close_auction_on_purchase RPC, fired from the _on_payment_captured
 * trigger when the payment row flips pending → captured. That keeps
 * the close logic in one place and same for mock + real webhooks.
 *
 * Mirrors the deposit endpoint shape: returns either `{ ok, hostedUrl,
 * mocked }` (redirect the client to the gateway / reload on mocked) or
 * a structured error.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id: auctionId } = await ctx.params;
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const provider = (body.provider as PaymentProvider) ?? "konnect";

  // Fetch authoritative auction + property data. We never trust a
  // client-supplied amount — we read sale_price / buy_now_price from
  // the row to defend against price tampering.
  const { data: auction } = await supabase
    .from("auctions")
    .select(
      "id, status, listing_type, opening_price, sale_price, buy_now_price, property:properties (owner_id, title)",
    )
    .eq("id", auctionId)
    .single();
  if (!auction) {
    return NextResponse.json({ error: "auction_not_found" }, { status: 404 });
  }

  const a = auction as unknown as {
    id: string;
    status: string;
    listing_type: "auction" | "direct";
    opening_price: number;
    sale_price: number | null;
    buy_now_price: number | null;
    property: { owner_id: string; title: string };
  };

  // Open-for-purchase check. Direct listings sit in 'scheduled' since
  // they don't tick through the auction state machine; auctions need
  // to be live or extending.
  const openForPurchase =
    (a.listing_type === "direct" && ["scheduled", "live", "extending"].includes(a.status))
    || (a.listing_type === "auction" && ["live", "extending"].includes(a.status));
  if (!openForPurchase) {
    return NextResponse.json({ error: "auction_closed" }, { status: 409 });
  }

  // Determine the purchase amount from the DB row, not the client.
  const amount =
    a.listing_type === "direct" ? Number(a.sale_price) : Number(a.buy_now_price);
  if (!amount || amount <= 0) {
    return NextResponse.json(
      { error: "buy_now_not_available", detail: "This listing doesn't support a one-shot purchase." },
      { status: 400 },
    );
  }

  if (a.property.owner_id === user.id) {
    return NextResponse.json({ error: "self_purchase_forbidden" }, { status: 403 });
  }

  // KYC gate — same as bidding. We don't want a buyer who can't sign
  // at the notary closing the auction.
  const { data: profile } = await supabase
    .from("profiles")
    .select("kyc_status, full_name, phone")
    .eq("id", user.id)
    .single();
  if (!profile || profile.kyc_status !== "verified") {
    return NextResponse.json({ error: "kyc_required" }, { status: 403 });
  }

  // Idempotency: if this user already has a captured buy-now payment
  // on this auction, just return success — the trigger has already
  // closed the auction.
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("user_id", user.id)
    .eq("auction_id", auctionId)
    .eq("kind", "buy_now")
    .eq("status", "captured")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, alreadyPurchased: true });
  }

  // Create the pending payment row first so we have an id for the
  // gateway. The webhook flips it to 'captured' in production; in dev
  // the mock provider returns immediately and we capture it inline below.
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "buy_now",
      provider,
      amount,
      auction_id: auctionId,
      status: "pending",
      metadata: { listing_type: a.listing_type, initiated_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (payErr || !payment) {
    return NextResponse.json(
      { error: payErr?.message ?? "payment_insert_failed" },
      { status: 500 },
    );
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const init = await initiatePayment(provider, {
    amountTND: amount,
    description:
      a.listing_type === "direct"
        ? `Direct purchase · ${a.property.title}`
        : `Buy-now · auction ${auctionId.slice(0, 8)}`,
    ourPaymentId: payment.id as string,
    successUrl: `${base}/payment/success?id=${payment.id}&return=/auctions/${auctionId}`,
    failUrl: `${base}/payment/failed?id=${payment.id}`,
    customer: {
      email: user.email ?? "",
      name: profile.full_name ?? null,
      phone: profile.phone ?? null,
    },
  });

  // Service-role for the provider_ref stamp — payments has no UPDATE
  // RLS policy for the owner, so the auth'd client silently no-ops.
  // See the deposit endpoint for the longer rationale.
  const admin = getServiceSupabase();
  if (admin) {
    await admin
      .from("payments")
      .update({ provider_ref: init.providerRef })
      .eq("id", payment.id);
  }

  // Don't auto-capture inline. The /payment/mock simulation page
  // captures via /api/payments/mock-capture once the user lands on the
  // gateway; real providers capture via their webhook. Same DB trigger
  // (`_on_payment_captured` → close_auction_on_purchase) fires in both
  // paths, so the auction close behavior is identical regardless.
  return NextResponse.json({
    ok: true,
    hostedUrl: init.hostedUrl,
    mocked: init.providerRef.startsWith("mock-"),
    amount,
  });
}
