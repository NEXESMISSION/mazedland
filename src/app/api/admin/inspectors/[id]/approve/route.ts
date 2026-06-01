import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
