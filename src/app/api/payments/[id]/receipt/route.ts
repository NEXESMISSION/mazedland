import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { jsonObject } from "@/lib/http/body";
import { isUuid } from "@/lib/uuid";
import type { PaymentProvider } from "@/lib/payments/types";
import { objectExists } from "@/lib/listings/storage";

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
 *
 * A receipt an admin refused (status `failed` with a reviewer) takes a new
 * one too: the refusal says « vous pouvez en envoyer un nouveau » and links
 * here, and this answered 409 — the only way on was to buy again and leave
 * the refused row behind. The payment goes back to review, under nobody's
 * name, with the old motif cleared (the trail keeps it). A payment the seller
 * cancelled, or one replaced by another choice, has no reviewer and stays
 * closed.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id: paymentId } = await ctx.params;
  if (!isUuid(paymentId)) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await jsonObject(req);
  const provider = body.provider as PaymentProvider;
  // Up to 3 receipt images. New clients send `receipt_paths: string[]`; keep
  // `receipt_path` (single) for backward-compat. Cap at 3 SERVER-SIDE — never
  // trust the client for the limit.
  const rawPaths: unknown[] = Array.isArray(body.receipt_paths)
    ? body.receipt_paths
    : body.receipt_path != null
      ? [body.receipt_path]
      : [];
  const receiptPaths = rawPaths
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .slice(0, 3);
  if (
    receiptPaths.length === 0
    || (provider !== "bank_transfer" && provider !== "d17")
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Defence in depth: the upload bucket policy already constrains paths to the
  // user's UID folder, but reject anything outside that here too so a forged
  // client request can't reference a path it doesn't own. EVERY path must be
  // owner-scoped.
  if (!receiptPaths.every((p) => p.startsWith(`${user.id}/`))) {
    return NextResponse.json({ error: "path_not_owned" }, { status: 403 });
  }

  // Verify the payment belongs to the caller AND is in a state that
  // accepts a receipt. We re-fetch under the user's RLS-scoped client
  // so a forged paymentId belonging to another user just 404s.
  const { data: pay, error: payErr } = await supabase
    .from("payments")
    .select("id, user_id, status, reviewer_id")
    .eq("id", paymentId)
    .single();
  if (payErr || !pay) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }
  if (pay.user_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  // Allow re-upload only while the payment is still actionable — or after an
  // admin refused the receipt, when a new one is exactly what is asked for.
  const open = pay.status === "pending" || pay.status === "pending_review";
  const refused = pay.status === "failed" && pay.reviewer_id != null;
  if (!open && !refused) {
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

  // The files must be there: a path never uploaded used to move the payment
  // to « pending_review » with nothing for the moderator to look at.
  for (const p of receiptPaths) {
    if (!(await objectExists(admin, "receipts", p))) {
      return NextResponse.json({ error: "receipt_missing" }, { status: 400 });
    }
  }

  // Compare-and-set: only attach a receipt to a still-actionable row. If it was
  // captured/failed concurrently, match 0 rows rather than resurrecting it. A
  // refused one is matched on exactly that state: refused, by an admin.
  const update = admin
    .from("payments")
    .update({
      provider,
      receipt_urls: receiptPaths,
      // First image — keeps every existing single-image display (admin queue,
      // reject page, account/payments, deposits, listing-fee) working unchanged.
      receipt_url: receiptPaths[0],
      receipt_uploaded_at: new Date().toISOString(),
      status: "pending_review",
      // Back in the queue as a fresh receipt: the old motif would show in red
      // on a payment nobody has refused yet.
      ...(refused ? { reviewer_id: null, reviewed_at: null, admin_notes: null } : {}),
    })
    .eq("id", paymentId);
  const { data: updated, error: updErr } = await (refused
    ? update.eq("status", "failed").not("reviewer_id", "is", null)
    : update.in("status", ["pending", "pending_review"])
  ).select("id");
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
