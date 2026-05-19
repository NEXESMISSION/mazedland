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

  const body = await req.json().catch(() => ({}));
  const status = body.status as "ready" | "rejected" | undefined;
  const rejection_reason = body.rejection_reason ?? null;
  if (status !== "ready" && status !== "rejected") {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  // Fetch the property owner + title before update so we can notify after.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, owner_id, title")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("properties")
    .update({
      status,
      rejection_reason: status === "rejected" ? rejection_reason : null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (prop?.owner_id) {
    const admin = getServiceSupabase();
    if (admin) {
      const titleClause = prop.title ? `« ${prop.title} »` : "votre annonce";
      if (status === "ready") {
        await admin.rpc("enqueue_notification", {
          p_user_id: prop.owner_id,
          p_kind: "listing_approved",
          p_title: "Annonce approuvée",
          p_body: `${titleClause} a été validé par l'équipe et est désormais visible.`,
          p_link: `/properties/${id}`,
        });
      } else {
        const reason = (rejection_reason ?? "").toString().trim();
        await admin.rpc("enqueue_notification", {
          p_user_id: prop.owner_id,
          p_kind: "listing_rejected",
          p_title: "Annonce refusée",
          p_body: reason
            ? `Motif : ${reason}. Vous pouvez corriger votre annonce et la soumettre à nouveau.`
            : `${titleClause} a été refusé par l'équipe. Consultez votre tableau de bord pour les détails.`,
          p_link: "/sell",
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
