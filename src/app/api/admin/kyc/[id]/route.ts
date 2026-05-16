import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
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
  const notes: string = body.notes ?? "";
  const subjectId: string = body.user_id;
  if (!subjectId || (verdict !== "verified" && verdict !== "rejected")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Update both rows in a single transaction so we don't end up with
  // a verified submission that didn't update the user's `kyc_status`.
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

  return NextResponse.json({ ok: true });
}
