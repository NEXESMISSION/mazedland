import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { checkSetting, rangeOf } from "@/lib/settings/define";
import { SETTINGS, isSettingKey } from "@/lib/settings/registry";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * PUT /api/admin/settings — admin-only. `{ key: value, … }` for any setting
 * in the registry (src/lib/settings/registry.ts); each value is checked
 * against its definition, and one that does not fit refuses the whole save
 * with the key and the reason, so the console can point at the field.
 *
 * `null` for a key puts it back to its default (the row is deleted). A key
 * that is not in the registry is refused: a setting the site does not read
 * is the worst kind — the admin sees « enregistré » and nothing moves.
 */
export async function PUT(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const t = await apiTranslator(req, "settingsRegistry.errors");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const rows: { key: string; value: unknown; updated_by: string; updated_at: string }[] = [];
  const reset: string[] = [];
  const now = new Date().toISOString();
  for (const [key, raw] of Object.entries(body)) {
    if (!isSettingKey(key)) {
      return NextResponse.json({ error: "unknown_setting", key }, { status: 400 });
    }
    if (raw === null && !("optional" in SETTINGS[key] && SETTINGS[key].optional)) {
      reset.push(key);
      continue;
    }
    const def = SETTINGS[key];
    const checked = checkSetting(def, raw);
    if (!checked.ok) {
      return NextResponse.json(
        { error: "invalid_setting", key, reason: checked.error, detail: t(checked.error, rangeOf(def)) },
        { status: 400 },
      );
    }
    rows.push({ key, value: checked.value, updated_by: user.id, updated_at: now });
  }
  if (rows.length === 0 && reset.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  if (rows.length > 0) {
    const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
    if (error) return fail("settings_update_failed", 500, error);
  }
  if (reset.length > 0) {
    const { error } = await admin.from("app_settings").delete().in("key", reset);
    if (error) return fail("settings_update_failed", 500, error);
  }

  // Bank details are logged as changed, never with their value.
  logAction(req, user, "settings.update", { keys: rows.map((r) => r.key), reset });
  return NextResponse.json({ ok: true, updated: rows.length + reset.length });
}
