import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
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

  const now = new Date().toISOString();

  // Update both rows so we don't end up with a verified submission that
  // didn't update the user's `kyc_status`.
  const { error: e1 } = await supabase
    .from("kyc_submissions")
    .update({ status: verdict, reviewer_id: user.id, rejection_reason: notes, reviewed_at: now })
    .eq("id", id);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const { error: e2 } = await supabase
    .from("profiles")
    .update({
      kyc_status: verdict,
      kyc_verified_at: verdict === "verified" ? now : null,
    })
    .eq("id", subjectId);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

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
        p_link: "/kyc/status",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
