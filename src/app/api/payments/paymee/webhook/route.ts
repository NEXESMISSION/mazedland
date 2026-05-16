import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/admin";

/**
 * Paymee webhook. Paymee posts JSON to the URL set as `webhook_url` in
 * the create-payment call. The body shape:
 *
 *   {
 *     "token": "<provider_ref>",
 *     "amount": 1234.50,
 *     "check_sum": "<sha256_hex(amount + token + apiToken)>",
 *     "payment_status": true,
 *     "order_id": "<our payments.id>",
 *     ...
 *   }
 *
 * Their integrity scheme is `check_sum = sha256(amount + token + apiToken)`
 * — not a true HMAC but enough to prove the caller knows our token.
 * We compute the same digest with `node:crypto` and compare via
 * `timingSafeEqual` to avoid leaking via timing.
 *
 * Side effects on capture (deposit lock → auction_deposits row) come
 * from the _on_payment_captured DB trigger (0007_state_machine.sql).
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.PAYMEE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as
    | {
        token?: string;
        amount?: number | string;
        check_sum?: string;
        payment_status?: boolean;
        order_id?: string;
      }
    | null;
  if (!body?.token || !body?.order_id || typeof body.amount === "undefined") {
    return NextResponse.json({ error: "malformed_body" }, { status: 400 });
  }

  // Verify Paymee's check_sum.
  const digest = createHmac("sha256", "")
    .update(String(body.amount) + body.token + apiKey)
    .digest("hex");
  const expected = Buffer.from(digest, "hex");
  const provided = Buffer.from(body.check_sum ?? "", "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "checksum_mismatch" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "no_admin_client" }, { status: 503 });

  const { data: payment } = await admin
    .from("payments")
    .select("id, status, provider, provider_ref")
    .eq("id", body.order_id)
    .single();
  if (!payment) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  if (payment.provider !== "paymee") {
    return NextResponse.json({ error: "provider_mismatch" }, { status: 409 });
  }
  if (payment.provider_ref && payment.provider_ref !== body.token) {
    return NextResponse.json({ error: "ref_mismatch" }, { status: 409 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ ok: true, alreadySettled: true });
  }

  const newStatus = body.payment_status ? "captured" : "failed";
  const { error: updateErr } = await admin
    .from("payments")
    .update({ status: newStatus, metadata: { paymee: body } })
    .eq("id", body.order_id)
    .eq("status", "pending");
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: newStatus });
}
