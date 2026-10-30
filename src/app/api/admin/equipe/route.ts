import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { audit } from "@/lib/admin/audit";
import { cleanScopes } from "@/lib/admin/sections";
import { otherFullAdmins } from "@/lib/admin/team";

/**
 * The console team (/admin/equipe), a full admin's screen.
 *
 *   POST   { userId, scopes: "full" | string[] }  → add someone, or change their sections
 *   DELETE { userId }                              → take their console access away
 *
 * Nobody changes their own access here — a slip would lock them out — and the
 * last full admin keeps theirs. Each change goes in the audit trail with the
 * access before and after.
 */

type Body = { userId?: unknown; scopes?: unknown };

async function target(req: NextRequest) {
  const gate = await requireAdmin(req, "equipe");
  if (gate instanceof NextResponse) return { res: gate };
  const admin = getServiceSupabase();
  if (!admin) return { res: fail("server_misconfigured", 500) };
  const body = (await jsonObject(req)) as Body;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const t = await apiTranslator(req, "adminTeam.api");
  if (!userId) return { res: NextResponse.json({ error: "invalid" }, { status: 400 }) };
  if (userId === gate.user.id) {
    return { res: NextResponse.json({ error: "self", detail: t("self") }, { status: 400 }) };
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, role, admin_scopes, banned_at, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return { res: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  return { gate, admin, body, profile, t };
}

export async function POST(req: NextRequest) {
  const r = await target(req);
  if ("res" in r) return r.res;
  const { gate, admin, body, profile, t } = r;

  if (profile.banned_at) {
    return NextResponse.json({ error: "banned", detail: t("banned") }, { status: 409 });
  }
  const scopes = body.scopes === "full" ? null : cleanScopes(body.scopes);
  if (body.scopes !== "full" && scopes === null) {
    return NextResponse.json({ error: "invalid", detail: t("chooseSections") }, { status: 400 });
  }
  // Narrowing the last full admin leaves nobody to manage the team.
  if (profile.role === "admin" && profile.admin_scopes === null && scopes !== null
      && (await otherFullAdmins(admin, profile.id)) === 0) {
    return NextResponse.json({ error: "last_full_admin", detail: t("lastFullAdmin") }, { status: 409 });
  }

  const { error } = await admin.from("profiles").update({ role: "admin", admin_scopes: scopes }).eq("id", profile.id);
  if (error) return fail("team_update_failed", 500, error);

  const joined = profile.role !== "admin";
  logAction(req, gate.user, joined ? "admin.team.add" : "admin.team.update", { id: profile.id, scopes });
  await audit(admin, gate.user.id, {
    action: joined ? "team.add" : "team.update", targetType: "profile", targetId: profile.id,
    before: { role: profile.role, admin_scopes: profile.admin_scopes },
    after: { role: "admin", admin_scopes: scopes },
  });
  return NextResponse.json({ ok: true, scopes });
}

export async function DELETE(req: NextRequest) {
  const r = await target(req);
  if ("res" in r) return r.res;
  const { gate, admin, profile, t } = r;

  if (profile.role !== "admin") return NextResponse.json({ ok: true, removed: false });
  if (profile.admin_scopes === null && (await otherFullAdmins(admin, profile.id)) === 0) {
    return NextResponse.json({ error: "last_full_admin", detail: t("lastFullAdmin") }, { status: 409 });
  }

  // Back to an ordinary account; their annonces and their agence stay theirs.
  const { error } = await admin.from("profiles").update({ role: "individual", admin_scopes: null }).eq("id", profile.id);
  if (error) return fail("team_update_failed", 500, error);

  logAction(req, gate.user, "admin.team.remove", { id: profile.id });
  await audit(admin, gate.user.id, {
    action: "team.remove", targetType: "profile", targetId: profile.id,
    before: { role: profile.role, admin_scopes: profile.admin_scopes },
    after: { role: "individual", admin_scopes: null },
  });
  return NextResponse.json({ ok: true, removed: true });
}
