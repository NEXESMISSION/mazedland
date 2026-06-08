import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Admin queue inspector — delete a single notification.
 *
 * Authorization: same-origin + role=admin. RLS policy
 * `notifications_admin_delete` (migration 0033) enforces this at the
 * database level too.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id);

  if (error) return fail("notification_delete_failed", 500, error);
  logAction(req, user, "notification.delete", { notificationId: id });
  return NextResponse.json({ ok: true });
}
