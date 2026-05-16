import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { initiatePayment } from "@/lib/payments";
import { isSameOrigin } from "@/lib/sameOrigin";
import { depositForOpening } from "@/lib/utils";
import type { PaymentProvider } from "@/lib/payments/types";

/**
 * Lock the 10% participation deposit for an auction (plan §5).
 *
 * Returns the gateway hosted URL the client should redirect to. After
 * the gateway captures the payment, the webhook flips
 * `payments.status='captured'`, and a DB trigger (TODO) inserts the
 * matching `auction_deposits` row.
 *
 * Until that webhook is wired in production, dev rides on the mock
 * checkout: this endpoint pre-creates the `auction_deposits` row right
 * here so the bid flow works end-to-end without a real gateway. The
 * service-role insert is fine because the same RLS-bypassed write
 * would happen from the webhook in production.
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
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const provider = (body.provider as PaymentProvider) ?? "konnect";

  // Re-fetch the auction + property so the gates use authoritative state.
  const { data: auction } = await supabase
    .from("auctions")
    .select("id, opening_price, status, property:properties (owner_id)")
    .eq("id", auctionId)
    .single();
  if (!auction) return NextResponse.json({ error: "auction_not_found" }, { status: 404 });
  if (!["scheduled", "live", "extending"].includes(auction.status as string)) {
    return NextResponse.json({ error: "auction_closed" }, { status: 409 });
  }
  const ownerId = (auction as unknown as { property: { owner_id: string } }).property.owner_id;
  if (ownerId === user.id) {
    return NextResponse.json({ error: "owner_cannot_bid" }, { status: 403 });
  }

  // KYC gate: the bid endpoint also checks this, but failing here gives
  // a useful error before the user is bounced through the gateway.
  const { data: profile } = await supabase
    .from("profiles").select("kyc_status, full_name, phone").eq("id", user.id).single();
  if (!profile || profile.kyc_status !== "verified") {
    return NextResponse.json({ error: "kyc_required" }, { status: 403 });
  }

  // Idempotency: if there's already an active (not released/forfeited)
  // deposit, just return success — the user can bid already.
  const { data: existing } = await supabase
    .from("auction_deposits")
    .select("id")
    .eq("auction_id", auctionId)
    .eq("user_id", user.id)
    .is("released_at", null)
    .is("forfeited_at", null)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, alreadyLocked: true });
  }

  const amount = depositForOpening(Number(auction.opening_price));

  // Create the pending payment row first so we have an id for the
  // gateway. The mock checkout flips it to 'captured' on its own; real
  // gateways do it from the webhook.
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      user_id: user.id, kind: "deposit_lock", provider, amount,
      auction_id: auctionId, status: "pending",
      metadata: { initiated_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (payErr || !payment) {
    return NextResponse.json({ error: payErr?.message ?? "payment_insert_failed" }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const init = await initiatePayment(provider, {
    amountTND: amount,
    description: `Deposit for auction ${auctionId.slice(0, 8)}`,
    ourPaymentId: payment.id as string,
    successUrl: `${base}/payment/success?id=${payment.id}&return=/auctions/${auctionId}`,
    failUrl: `${base}/payment/failed?id=${payment.id}`,
    customer: {
      email: user.email ?? "",
      name: profile.full_name ?? null,
      phone: profile.phone ?? null,
    },
  });

  // Stamp the provider_ref via service role — the payments table has
  // only SELECT + INSERT policies for the owner, no UPDATE, so the
  // auth'd client's update silently affects 0 rows. The mock-capture
  // endpoint later requires provider_ref to start with "mock-" before
  // it'll flip the row to captured; without this write, every mock
  // payment fails with "not_a_mock_payment".
  const admin = getServiceSupabase();
  if (admin) {
    await admin
      .from("payments")
      .update({ provider_ref: init.providerRef })
      .eq("id", payment.id);
  }

  // We no longer auto-capture inline. The /payment/mock simulation
  // page does that via /api/payments/mock-capture once the user is
  // visually on the gateway; real gateways do it via their webhook.
  // Returning the hostedUrl keeps the flow identical for mock vs real.
  return NextResponse.json({
    ok: true,
    hostedUrl: init.hostedUrl,
    mocked: init.providerRef.startsWith("mock-"),
  });
}
