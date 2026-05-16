import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";

/**
 * Konnect webhook: GET ?payment_ref=...
 * Konnect's flow is "GET status by ref" — they call us, we go back to
 * the Konnect API with our key to confirm the status. The route is
 * hardened against:
 *
 *   1. Spoofed callers — we never trust the query-string status; we
 *      always re-fetch from Konnect with our `x-api-key`.
 *   2. Cross-provider confusion — we require the matching `payments`
 *      row to declare `provider='konnect'` so an attacker can't use
 *      Konnect's reply to flip a Paymee/Flouci payment.
 *   3. Replay — we only transition from `pending`. Repeated webhooks
 *      after capture become no-ops (and the deposit-confirm trigger
 *      is idempotent against repeat captures anyway).
 *   4. ID confusion — the orderId Konnect echoes back must match a
 *      pending payment we own, AND that row's provider_ref must
 *      match the looked-up ref.
 *
 * The DB-level _on_payment_captured trigger (0007_state_machine.sql)
 * materializes auction_deposits on the pending→captured transition.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("payment_ref");
  if (!ref) return NextResponse.json({ error: "missing_ref" }, { status: 400 });

  const apiKey = process.env.KONNECT_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const verify = await fetch(`https://api.konnect.network/api/v2/payments/${ref}`, {
    headers: { "x-api-key": apiKey },
    // Don't let a slow Konnect lookup hold the worker forever.
    signal: AbortSignal.timeout(8_000),
  });
  if (!verify.ok) return NextResponse.json({ error: "verify_failed" }, { status: 502 });

  const data = (await verify.json()) as {
    payment?: { status: string; orderId: string; token?: string };
  };
  const payload = data.payment;
  if (!payload?.orderId) {
    return NextResponse.json({ error: "malformed_konnect_reply" }, { status: 502 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "no_admin_client" }, { status: 503 });

  // Fetch the payment row we own — bail unless it's a konnect-provider
  // pending row whose provider_ref matches.
  const { data: payment, error: lookupErr } = await admin
    .from("payments")
    .select("id, status, provider, provider_ref, user_id, kind, auction_id")
    .eq("id", payload.orderId)
    .single();
  if (lookupErr || !payment) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }
  if (payment.provider !== "konnect") {
    return NextResponse.json({ error: "provider_mismatch" }, { status: 409 });
  }
  if (payment.provider_ref && payment.provider_ref !== ref) {
    return NextResponse.json({ error: "ref_mismatch" }, { status: 409 });
  }
  if (payment.status !== "pending") {
    // Idempotent: already settled. Return ok so Konnect stops retrying.
    return NextResponse.json({ ok: true, alreadySettled: true });
  }

  const newStatus = payload.status === "completed" ? "captured" : "failed";
  const { error: updateErr } = await admin
    .from("payments")
    .update({ status: newStatus, metadata: { konnect: payload } })
    .eq("id", payload.orderId)
    .eq("status", "pending"); // CAS: avoid races with a concurrent webhook.
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: newStatus });
}
