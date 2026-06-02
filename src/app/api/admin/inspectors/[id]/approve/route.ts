import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;

  const now = new Date().toISOString();

  // 1. Flip the inspector record to approved.
  const { error: e1 } = await supabase
    .from("inspectors")
    .update({ approved: true, approved_at: now })
    .eq("id", id);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // 2. Elevate the profile role so the inspector passes role-gated
  //    queries (RLS policies, admin/inspector router checks). Without
  //    this the user is "approved" in the inspectors table but still
  //    has role='individual' everywhere else and can't act.
  //    Works because is_admin() (migration 0016) now recognises
  //    profiles.role='admin' for the caller, so the profile-guard
  //    trigger lets the change through.
  const { error: e2 } = await supabase
    .from("profiles")
    .update({ role: "inspector" })
    .eq("id", id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Notify the new inspector.
  const admin = getServiceSupabase();
  if (admin) {
    await admin.rpc("enqueue_notification", {
      p_user_id: id,
      p_kind: "inspector_approved",
      p_title: "Vous êtes approuvé comme inspecteur",
      p_body: "Votre compte inspecteur a été validé. Vous pouvez désormais accepter des missions sur Batta.tn.",
      p_link: "/inspector",
    });
  }

  logAction(req, user, "inspector.approved", { inspectorId: id });
  return NextResponse.json({ ok: true });
}
