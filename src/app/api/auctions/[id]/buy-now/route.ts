import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * Buy-now / direct-sale purchase — manual receipt flow.
 *
 * Creates a pending `payments` row for the user against this auction
 * and returns its id. The buyer then goes through /payment/checkout
 * (provider chooser + instructions + receipt upload). The admin
 * accepts the receipt → status='captured' → the
 * `_on_payment_captured` DB trigger fires `close_auction_on_purchase`
 * which closes the auction atomically.
 *
 * No gateway, no hostedUrl. The /payment/checkout page is the next
 * step for the client.
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

  const openForPurchase =
    (a.listing_type === "direct" && ["scheduled", "live", "extending"].includes(a.status))
    || (a.listing_type === "auction" && ["live", "extending"].includes(a.status));
  if (!openForPurchase) {
    return NextResponse.json({ error: "auction_closed" }, { status: 409 });
  }

  const amount =
    a.listing_type === "direct" ? Number(a.sale_price) : Number(a.buy_now_price);
  if (!amount || amount <= 0) {
    return NextResponse.json(
      { error: "buy_now_not_available" },
      { status: 400 },
    );
  }

  if (a.property.owner_id === user.id) {
    return NextResponse.json({ error: "self_purchase_forbidden" }, { status: 403 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("kyc_status").eq("id", user.id).single();
  if (!profile || profile.kyc_status !== "verified") {
    return NextResponse.json({ error: "kyc_required" }, { status: 403 });
  }

  // Idempotency: already captured.
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

  // Reuse a pending row if the buyer reopens the flow.
  const { data: pending } = await supabase
    .from("payments")
    .select("id")
    .eq("user_id", user.id)
    .eq("auction_id", auctionId)
    .eq("kind", "buy_now")
    .eq("status", "pending")
    .maybeSingle();

  if (pending) {
    return NextResponse.json({ ok: true, paymentId: pending.id, amount });
  }

  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "buy_now",
      provider: "bank_transfer",
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

  return NextResponse.json({ ok: true, paymentId: payment.id, amount });
}
