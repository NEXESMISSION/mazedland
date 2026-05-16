import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { initiatePayment } from "@/lib/payments";
import { isSameOrigin } from "@/lib/sameOrigin";
import type { PaymentProvider, PaymentKind } from "@/lib/payments/types";

/**
 * Body:
 *   {
 *     provider: "konnect" | "paymee" | "flouci" | "d17",
 *     kind: "deposit_lock" | "inspection_fee" | "commission" | "subscription",
 *     amount: number (TND),
 *     auction_id?: uuid,
 *     inspection_id?: uuid,
 *     successUrl?: string,
 *     failUrl?: string,
 *   }
 *
 * Inserts a `payments` row with status='pending' so we can reconcile
 * with the gateway's webhook later, then returns the hosted URL.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const provider = body.provider as PaymentProvider;
  const kind = body.kind as PaymentKind;
  const amount = Number(body.amount);
  if (!provider || !kind || !amount || amount <= 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("full_name, phone").eq("id", user.id).single();

  // Insert pending payment so we have an id to wire to the gateway.
  const { data: payment, error: insertErr } = await supabase
    .from("payments")
    .insert({
      user_id: user.id,
      kind,
      provider,
      amount,
      status: "pending",
      auction_id: body.auction_id ?? null,
      inspection_id: body.inspection_id ?? null,
      metadata: { initiated_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (insertErr || !payment) {
    return NextResponse.json({ error: insertErr?.message ?? "insert_failed" }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const result = await initiatePayment(provider, {
    amountTND: amount,
    description: `Batta · ${kind}`,
    ourPaymentId: payment.id as string,
    successUrl: body.successUrl ?? `${base}/payment/success?id=${payment.id}`,
    failUrl: body.failUrl ?? `${base}/payment/failed?id=${payment.id}`,
    customer: {
      email: user.email ?? "",
      name: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
    },
  });

  // Service-role write — payments has no UPDATE policy for the owner.
  // Without this, provider_ref stays null and mock-capture rejects the
  // payment with "not_a_mock_payment".
  const admin = getServiceSupabase();
  if (admin) {
    await admin
      .from("payments")
      .update({ provider_ref: result.providerRef })
      .eq("id", payment.id);
  }

  return NextResponse.json({ ok: true, hostedUrl: result.hostedUrl, paymentId: payment.id });
}
