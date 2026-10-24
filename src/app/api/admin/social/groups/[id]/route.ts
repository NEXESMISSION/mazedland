import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { parseGroupInput } from "@/lib/social/groups";

/**
 * PATCH /api/admin/social/groups/:id  { status: "active" | "paused" } or the whole group
 * DELETE /api/admin/social/groups/:id — the jobs that pointed at it keep their history.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = await apiTranslator(req, "adminSocial.errors");

  let update: Record<string, unknown>;
  if (Object.keys(body).length === 1 && (body.status === "active" || body.status === "paused")) {
    update = { status: body.status };
  } else {
    const parsed = parseGroupInput(body);
    if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(parsed.error) }, { status: 400 });
    update = parsed.value;
  }
  const { error } = await admin.from("social_group_directory").update(update).eq("id", id);
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("exists") }, { status: 409 });
  if (error) return fail("group_update_failed", 500, error);
  logAction(req, gate.user, "social.group_update", { id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const { error } = await admin.from("social_group_directory").delete().eq("id", id);
  if (error) return fail("group_delete_failed", 500, error);
  logAction(req, gate.user, "social.group_delete", { id });
  return NextResponse.json({ ok: true });
}
