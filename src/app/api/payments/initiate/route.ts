import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import type { PaymentKind } from "@/lib/payments/types";

/**
 * Manual-flow payment creator for non-auction payments (inspection
 * fees, commissions, subscriptions). Auction-tied payments
 * (deposit_lock, buy_now, final_payment) have their own validating
 * endpoints under /api/auctions/[id]/*.
 *
 * Returns `{ paymentId }`. The client then navigates to
 * /payment/checkout?type=<kind>&payment=<id> where the buyer picks a
 * method, sees instructions, and uploads a receipt.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kind = body.kind as PaymentKind;
  const amount = Number(body.amount);
  const ALLOWED_KINDS: PaymentKind[] = [
    "inspection_fee",
    "commission",
    "subscription",
    "deposit_release",
  ];
  if (!kind || !ALLOWED_KINDS.includes(kind) || !amount || amount <= 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { data: payment, error: insertErr } = await supabase
    .from("payments")
    .insert({
      user_id: user.id,
      kind,
      provider: "bank_transfer",
      amount,
      status: "pending",
      inspection_id: body.inspection_id ?? null,
      metadata: { initiated_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (insertErr || !payment) {
    return NextResponse.json(
      { error: insertErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, paymentId: payment.id });
}
