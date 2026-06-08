import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import type { PaymentProvider } from "@/lib/payments/types";

/**
 * Attach a receipt to a pending payment and flip it to
 * `pending_review` so admins see it in the queue.
 *
 * Body:
 *   {
 *     receipt_path: string,    // storage path under 'receipts/' bucket
 *     provider: "bank_transfer" | "d17",
 *   }
 *
 * The client uploaded the file to `receipts/<auth.uid>/<paymentId>.<ext>`
 * via the supabase-js storage client; the path is owner-scoped (RLS in
 * migration 0023) so other users can't reuse another user's upload.
 *
 * We re-check ownership here, set status='pending_review', stamp the
 * upload timestamp, and update the provider choice. Payments has no
 * UPDATE policy for the owner, so we use the service-role for the
 * mutation while keeping the auth context for ownership verification.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id: paymentId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const provider = body.provider as PaymentProvider;
  const receiptPath: string = body.receipt_path ?? "";
  if (
    !receiptPath
    || (provider !== "bank_transfer" && provider !== "d17")
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Defence in depth: the upload bucket policy already constrains paths
  // to the user's UID folder, but reject anything outside that here too
  // so a forged client request can't reference a path it doesn't own.
  if (!receiptPath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "path_not_owned" }, { status: 403 });
  }

  // Verify the payment belongs to the caller AND is in a state that
  // accepts a receipt. We re-fetch under the user's RLS-scoped client
  // so a forged paymentId belonging to another user just 404s.
  const { data: pay, error: payErr } = await supabase
    .from("payments")
    .select("id, user_id, status")
    .eq("id", paymentId)
    .single();
  if (payErr || !pay) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }
  if (pay.user_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  // Allow re-upload only while the payment is still actionable.
  if (pay.status !== "pending" && pay.status !== "pending_review") {
    return NextResponse.json(
      { error: "payment_already_resolved", status: pay.status },
      { status: 409 },
    );
  }

  // Service-role update — payments.update is restricted by RLS, but
  // the row's ownership + acceptable-state was just verified above.
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Compare-and-set: only attach a receipt to a still-actionable row. If it was
  // captured/failed concurrently, match 0 rows rather than resurrecting it.
  const { data: updated, error: updErr } = await admin
    .from("payments")
    .update({
      provider,
      receipt_url: receiptPath,
      receipt_uploaded_at: new Date().toISOString(),
      status: "pending_review",
    })
    .eq("id", paymentId)
    .in("status", ["pending", "pending_review"])
    .select("id");
  if (updErr) {
    return NextResponse.json({ error: "receipt_failed" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "payment_already_resolved" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
