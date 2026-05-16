import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * Admin endpoint to advance a payout through its lifecycle.
 *
 *   requested  → processing  (admin acknowledged, initiating bank transfer)
 *   processing → paid        (transfer confirmed)
 *   requested  → rejected    (admin declined; seller can resubmit)
 *
 * The is_admin() RLS policy on seller_payouts handles authorization; we
 * still re-check role here so the response is a proper 403 instead of
 * an empty update silently failing.
 */
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
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const status = body.status as "processing" | "paid" | "rejected" | undefined;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;
  if (!status || !["processing", "paid", "rejected"].includes(status)) {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    reviewer_id: user.id,
    reviewer_notes: notes,
  };
  if (status === "paid") {
    update.processed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("seller_payouts")
    .update(update)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
