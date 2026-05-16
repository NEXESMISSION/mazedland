import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * Mock-gateway capture endpoint.
 *
 * The /payment/mock page calls this after its simulated "processing"
 * spinner to flip a pending payment to captured. The CAS guard
 * (status=pending) plus the provider_ref must-start-with-`mock-`
 * check make it impossible to misuse on real provider payments —
 * only payments initiated through the mock path can be captured here.
 *
 * Auth: the caller must be the payment's owner OR an admin. Service
 * role is used internally to bypass payments RLS for the UPDATE; auth
 * is enforced via auth.getUser() before any service-role write happens.
 *
 * Once status flips to captured, the `_on_payment_captured` trigger
 * fires and materializes the side effects: auction_deposits row for
 * deposit_lock kind, auction close for buy_now / final_payment.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      {
        error: "service_role_missing",
        detail:
          "SUPABASE_SERVICE_ROLE_KEY not loaded server-side — restart the dev server with the key in .env.local.",
      },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  // Read the payment row first so we can validate ownership + mock
  // provenance before letting the capture flip happen. We use the
  // auth'd client here so the user can only read their own payment.
  const { data: payment } = await supabase
    .from("payments")
    .select("id, user_id, status, provider_ref, kind, amount, auction_id")
    .eq("id", id)
    .single();
  if (!payment) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }

  if (payment.user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!String(payment.provider_ref ?? "").startsWith("mock-")) {
    return NextResponse.json(
      {
        error: "not_a_mock_payment",
        detail: "This payment was not initiated through the mock provider.",
      },
      { status: 400 },
    );
  }
  if (payment.status === "captured") {
    // Idempotent: a duplicate capture call (browser back, double-click,
    // etc.) returns success rather than 409.
    return NextResponse.json({ ok: true, alreadyCaptured: true });
  }
  if (payment.status !== "pending") {
    return NextResponse.json(
      { error: "bad_status", detail: `payment is ${payment.status}` },
      { status: 409 },
    );
  }

  // Flip to captured. The trigger does the rest (deposit materialization
  // or auction close). CAS guard mirrors the webhook pattern.
  const { error: capErr } = await admin
    .from("payments")
    .update({ status: "captured" })
    .eq("id", id)
    .eq("status", "pending");
  if (capErr) {
    return NextResponse.json(
      { error: "capture_failed", detail: capErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
