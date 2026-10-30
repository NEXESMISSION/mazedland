import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { parseGroupInput } from "@/lib/social/groups";

/** POST /api/admin/social/groups — add a Facebook group to the directory (0170). */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const parsed = parseGroupInput(await jsonObject(req));
  const t = await apiTranslator(req, "adminSocial.errors");
  if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(parsed.error) }, { status: 400 });

  const { data, error } = await admin
    .from("social_group_directory")
    .insert({ ...parsed.value, created_by: gate.user.id })
    .select("id")
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("exists") }, { status: 409 });
  if (error || !data) return fail("group_create_failed", 500, error);
  logAction(req, gate.user, "social.group_create", { id: data.id });
  return NextResponse.json({ ok: true, id: data.id });
}
