import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * User-initiated cancellation of a pending payment.
 *
 *   POST /api/payments/[id]/cancel
 *
 * Allowed only when:
 *   - caller is the payment owner
 *   - status is 'pending' (no receipt uploaded yet)
 *
 * Once a receipt is uploaded the row moves to 'pending_review' and the
 * cancel button disappears from the UI — at that point the admin queue
 * already has it; cancelling client-side would be confusing.
 *
 * On cancel we set status='failed' with a fixed admin_notes marker so
 * the admin queue can filter out user-cancelled rows from genuine
 * rejections, and we best-effort remove any uploaded receipt from
 * storage (defence-in-depth — `pending` shouldn't have one, but the
 * client could have raced an upload).
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

  const { data: pay } = await supabase
    .from("payments")
    .select("id, user_id, status, receipt_url")
    .eq("id", paymentId)
    .single();
  if (!pay) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }
  if (pay.user_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }
  if (pay.status !== "pending") {
    return NextResponse.json(
      {
        error: "not_cancellable",
        detail:
          pay.status === "pending_review"
            ? "Le reçu est déjà en revue. Contactez l'administration pour annuler."
            : "Le paiement n'est plus annulable.",
      },
      { status: 409 },
    );
  }

  // payments has no UPDATE policy for the owner — flip status via the
  // service-role client. The ownership check above is the auth gate.
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { error: updErr } = await admin
    .from("payments")
    .update({
      status: "failed",
      admin_notes: "Annulé par l'utilisateur",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", paymentId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Best-effort receipt cleanup. `pending` rows shouldn't have a
  // receipt, but if a race uploaded one between the check and now we
  // don't want orphaned files. Ignore errors — the storage janitor
  // sweeps unreferenced objects on its own schedule.
  if (pay.receipt_url) {
    void admin.storage.from("receipts").remove([pay.receipt_url]);
  }

  return NextResponse.json({ ok: true });
}
