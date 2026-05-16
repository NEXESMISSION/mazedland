import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";

/**
 * Flouci webhook (verify-by-id pattern).
 *
 * Flouci redirects the user to `success_link?payment_id=<id>` and does
 * not POST to a webhook URL. We treat the callback like Konnect's
 * "GET status by ref": re-fetch the payment from Flouci with our
 * app secret before trusting any state.
 *
 * Auth posture:
 *  - The redirect URL is user-influenced (they can copy it), so we
 *    must never trust query-string status.
 *  - We re-verify against Flouci's `/payments/{id}` endpoint.
 *  - We require the matched `payments` row to be provider='flouci' and
 *    still `status='pending'`.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("payment_id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const appToken = process.env.FLOUCI_APP_TOKEN;
  const appSecret = process.env.FLOUCI_APP_SECRET;
  if (!appToken || !appSecret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const verify = await fetch(`https://developers.flouci.com/api/verify_payment/${id}`, {
    headers: {
      "Content-Type": "application/json",
      apppublic: appToken,
      appsecret: appSecret,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!verify.ok) return NextResponse.json({ error: "verify_failed" }, { status: 502 });
  const data = (await verify.json()) as {
    result?: { status?: string; developer_tracking_id?: string };
  };
  const result = data.result;
  if (!result?.developer_tracking_id) {
    return NextResponse.json({ error: "malformed_flouci_reply" }, { status: 502 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "no_admin_client" }, { status: 503 });

  const { data: payment } = await admin
    .from("payments")
    .select("id, status, provider, provider_ref")
    .eq("id", result.developer_tracking_id)
    .single();
  if (!payment) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  if (payment.provider !== "flouci") {
    return NextResponse.json({ error: "provider_mismatch" }, { status: 409 });
  }
  if (payment.provider_ref && payment.provider_ref !== id) {
    return NextResponse.json({ error: "ref_mismatch" }, { status: 409 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ ok: true, alreadySettled: true });
  }

  const newStatus = result.status === "SUCCESS" ? "captured" : "failed";
  const { error } = await admin
    .from("payments")
    .update({ status: newStatus, metadata: { flouci: result } })
    .eq("id", result.developer_tracking_id)
    .eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: newStatus });
}
