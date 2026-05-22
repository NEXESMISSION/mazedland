import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { parseMonetizationSettings, resolveDeposit } from "@/lib/pricing";

/**
 * Lock the participation deposit for an auction (amount resolved from the
 * admin's monetization settings — free / fixed / percent).
 *
 * Manual receipt flow: this endpoint creates a `payments` row with
 * status='pending' (no provider chosen yet) and returns its id. The
 * client redirects to /payment/checkout?type=deposit&auction=<id>,
 * which is where the user picks bank-transfer / D17, sees the
 * instructions, and uploads the receipt. The receipt-upload endpoint
 * (POST /api/payments/[id]/receipt) flips status to `pending_review`.
 * An admin then accepts (status='captured', deposit row created via
 * the _on_payment_captured trigger) or rejects.
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

  const { data: profile } = await supabase
    .from("profiles").select("kyc_status").eq("id", user.id).single();
  if (!profile || profile.kyc_status !== "verified") {
    return NextResponse.json({ error: "kyc_required" }, { status: 403 });
  }

  // Idempotency: if there's already an active deposit on this auction,
  // return success.
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

  // Resolve the deposit from admin settings: free / fixed / percent, plus
  // the global "free until" window.
  const { data: depRow } = await supabase
    .from("app_settings").select("value").eq("key", "deposit").maybeSingle();
  const depCfg = parseMonetizationSettings(
    new Map<string, unknown>([["deposit", depRow?.value]]),
  ).deposit;
  const { required, amount } = resolveDeposit(depCfg, Number(auction.opening_price));

  // Free entry — register a zero-amount participation row (place_bid only
  // checks a deposit row exists) and skip payment entirely.
  if (!required) {
    const admin = getServiceSupabase();
    if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    const { error: insErr } = await admin
      .from("auction_deposits")
      .insert({ auction_id: auctionId, user_id: user.id, amount: 0 });
    if (insErr && !/duplicate|unique/i.test(insErr.message)) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, free: true });
  }

  // Look for a pending payment we already created for this same auction
  // + user so we don't duplicate rows if the buyer hits /pay twice.
  const { data: pendingRows } = await supabase
    .from("payments")
    .select("id")
    .eq("user_id", user.id)
    .eq("auction_id", auctionId)
    .eq("kind", "deposit_lock")
    .in("status", ["pending", "pending_review"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (pendingRows && pendingRows.length > 0) {
    return NextResponse.json({ ok: true, paymentId: pendingRows[0].id, amount });
  }

  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "deposit_lock",
      provider: "bank_transfer", // default; buyer can switch at checkout
      amount,
      auction_id: auctionId,
      status: "pending",
      metadata: { initiated_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (payErr || !payment) {
    // Lost a concurrent create race: the partial unique index
    // (payments_one_active_auction) rejected our duplicate. Re-fetch the
    // winning request's row and return it instead of a raw 500.
    if (payErr && /duplicate|unique/i.test(payErr.message)) {
      const { data: raceRows } = await supabase
        .from("payments")
        .select("id")
        .eq("user_id", user.id)
        .eq("auction_id", auctionId)
        .eq("kind", "deposit_lock")
        .in("status", ["pending", "pending_review"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (raceRows?.[0]) {
        return NextResponse.json({ ok: true, paymentId: raceRows[0].id, amount });
      }
    }
    return NextResponse.json(
      { error: payErr?.message ?? "payment_insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, paymentId: payment.id, amount });
}
