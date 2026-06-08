import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { handleClaim } from "@/lib/admin/claim";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;

  const body = await req.json();

  // Claim / release (assigned-to-me) — returns early when handled.
  const claimResp = await handleClaim(supabase, "kyc_submissions", id, user.id, body.action);
  if (claimResp) return claimResp;

  const verdict: "verified" | "rejected" = body.verdict;
  const notes: string = (body.notes ?? "").trim().slice(0, 500);
  const subjectId: string = body.user_id;
  if (!subjectId || (verdict !== "verified" && verdict !== "rejected")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (verdict === "rejected" && !notes) {
    return NextResponse.json(
      { error: "reason_required", detail: "Une raison est requise pour rejeter une soumission KYC." },
      { status: 400 },
    );
  }

  // Atomic: update kyc_submissions + profiles together in one transaction via
  // the review_kyc RPC (migration 0058), so we can never land in a
  // "verified submission / unverified profile" mismatch.
  const { error: reviewErr } = await supabase.rpc("review_kyc", {
    p_submission_id: id,
    p_subject_id: subjectId,
    p_verdict: verdict,
    p_notes: notes,
  });
  if (reviewErr) return fail("kyc_review_failed", 500, reviewErr);

  // Notify the user. Notifications insert is service-role-only by
  // design (no INSERT policy on the table), so we go through the
  // admin client + `enqueue_notification` SECURITY DEFINER RPC.
  const admin = getServiceSupabase();
  if (admin) {
    if (verdict === "verified") {
      await admin.rpc("enqueue_notification", {
        p_user_id: subjectId,
        p_kind: "kyc_verified",
        p_title: "Identité vérifiée",
        p_body: "Votre KYC a été approuvé — vous pouvez maintenant enchérir et acheter.",
        p_link: "/properties",
      });
    } else {
      await admin.rpc("enqueue_notification", {
        p_user_id: subjectId,
        p_kind: "kyc_rejected",
        p_title: "Vérification d'identité refusée",
        p_body: `Motif : ${notes}. Vous pouvez relancer la vérification depuis votre page KYC.`,
        p_link: "/kyc",
      });
    }
  }

  logAction(req, user, `kyc.${verdict}`, { submissionId: id, subjectId });
  return NextResponse.json({ ok: true });
}
