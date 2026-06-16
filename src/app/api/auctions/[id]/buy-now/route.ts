import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { log } from "@/lib/log";

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
      "id, status, listing_type, opening_price, sale_price, buy_now_price, current_price, property:properties (owner_id, title)",
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
    current_price: number | null;
    property: { owner_id: string; title: string };
  };

  const openForPurchase =
    (a.listing_type === "direct" && ["scheduled", "live", "extending"].includes(a.status))
    || (a.listing_type === "auction" && ["live", "extending"].includes(a.status));
  if (!openForPurchase) {
    return NextResponse.json({ error: "auction_closed" }, { status: 409 });
  }

  // Once the standing high bid has met/exceeded the buy-now price, buy-now is
  // retired — it must NOT close under the current leader (who would otherwise
  // be displaced + refunded). Defense-in-depth: close_auction_on_purchase
  // (0085) also no-ops this case at capture time.
  if (
    a.listing_type === "auction" &&
    a.buy_now_price != null &&
    a.current_price != null &&
    Number(a.current_price) >= Number(a.buy_now_price)
  ) {
    return NextResponse.json(
      { error: "buy_now_unavailable", detail: "Les enchères ont atteint ou dépassé le prix d'achat immédiat." },
      { status: 409 },
    );
  }

  const fullPrice =
    a.listing_type === "direct" ? Number(a.sale_price) : Number(a.buy_now_price);
  if (!fullPrice || fullPrice <= 0) {
    return NextResponse.json(
      { error: "buy_now_not_available" },
      { status: 400 },
    );
  }

  // Net any active deposit the buyer already locked on THIS auction. The
  // winner's caution is "part of the purchase" (mirrors final_payment), so the
  // buy-now charge is (price − deposit); the deposit stays locked and
  // close_auction_on_purchase validates (amount + deposit) == price. Direct
  // sales have no deposit, so credit resolves to 0 and the full price is
  // charged. Computing it HERE (not just in checkout) keeps the stored row
  // amount == the charged amount no matter which entry path created it.
  const { data: depRows } = await supabase
    .from("auction_deposits")
    .select("amount")
    .eq("auction_id", auctionId)
    .eq("user_id", user.id)
    .is("released_at", null)
    .is("forfeited_at", null)
    .order("amount", { ascending: false })
    .limit(1);
  const credit = Number(depRows?.[0]?.amount ?? 0);
  const amount = Math.max(0, Math.round((fullPrice - credit) * 100) / 100);

  if (a.property.owner_id === user.id) {
    return NextResponse.json({ error: "self_purchase_forbidden" }, { status: 403 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("kyc_status").eq("id", user.id).single();
  if (!profile || profile.kyc_status !== "verified") {
    return NextResponse.json({ error: "kyc_required" }, { status: 403 });
  }

  // Rare (audit #22): the buyer's locked caution already covers the full price,
  // so there is nothing left to charge — and a 0-amount payment row is rejected
  // (payments.amount > 0), which used to 500 here. Hand it to an admin to
  // finalise instead: the caution must be split into the sale price (seller
  // earnings) + any excess refunded, which the automated payment path doesn't
  // model. This returns a clean, actionable response rather than a 500.
  if (amount === 0) {
    const sb = getServiceSupabase();
    if (sb) {
      await sb
        .rpc("_notify_admins", {
          p_kind: "admin_refund_due",
          p_title: "Achat couvert par la caution — à finaliser",
          p_body: `Un acheteur veut un achat immédiat dont la caution (${credit.toFixed(
            2,
          )} TND) couvre déjà le prix (${fullPrice.toFixed(
            2,
          )} TND). Finalisez la vente et remboursez l'excédent manuellement.`,
          p_link: `/admin/auctions/${auctionId}`,
        })
        .then(() => {}, () => {});
    }
    return NextResponse.json(
      {
        error: "deposit_covers_price",
        detail:
          "Votre caution couvre déjà le prix. Notre équipe finalise votre achat — vous serez contacté.",
      },
      { status: 409 },
    );
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
    // Reconcile a possibly-stale stored amount to the freshly netted value so
    // the charged amount always matches what we display. Service-role: the
    // user can't update payments directly (locked down), and the row may have
    // been created at the full price before deposit-netting.
    const reconcile = getServiceSupabase();
    if (reconcile) {
      await reconcile.from("payments").update({ amount }).eq("id", pending.id);
    }
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
    // Redact the raw Postgres/PostgREST message (table/column/constraint recon);
    // log it server-side instead.
    if (payErr) log.scope("api").error("buy_now payment insert failed", { msg: payErr.message });
    return NextResponse.json(
      { error: "payment_insert_failed" },
      { status: 500 },
    );
  }

  // Confirmation receipt for the buyer — they now need to upload proof of
  // payment on /payment/checkout. The admin will issue a payment_accepted
  // notification on approval.
  const admin = getServiceSupabase();
  if (admin) {
    const titleClause = a.property.title ? `« ${a.property.title} »` : "ce bien";
    await admin.rpc("enqueue_notification", {
      p_user_id: user.id,
      p_kind: "buy_now_initiated",
      p_title: "Achat initié",
      p_body: `Téléversez votre reçu pour finaliser l'achat de ${titleClause} (${amount.toFixed(2)} TND).`,
      p_link: `/payment/checkout?payment=${payment.id}`,
    });
  }

  return NextResponse.json({ ok: true, paymentId: payment.id, amount });
}
