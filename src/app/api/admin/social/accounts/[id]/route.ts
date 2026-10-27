import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * DELETE /api/admin/social/accounts/:id — disconnect a page. The token is
 * erased, not just flagged; the jobs that would have used it go to a person.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The page and the Instagram account that posts with its token.
  const { data: linked } = await admin.from("social_accounts").select("id").eq("parent_account_id", id);
  const ids = [id, ...((linked ?? []) as { id: string }[]).map((a) => a.id)];
  const { error } = await admin
    .from("social_accounts")
    .update({ status: "disconnected", token_sealed: null, token_expires_at: null })
    .in("id", ids);
  if (error) return fail("account_disconnect_failed", 500, error);
  await admin
    .from("social_publication_jobs")
    .update({ status: "manual_action_required", manual_reason: "no_account" })
    .in("account_id", ids)
    .eq("status", "scheduled");
  logAction(req, gate.user, "social.account_disconnect", { id });
  return NextResponse.json({ ok: true });
}
