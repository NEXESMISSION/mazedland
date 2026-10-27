import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { getSettings } from "@/lib/settings/server";
import { recordConsents } from "@/lib/consents/server";

/**
 * POST /api/account/sms-pref  { enabled: boolean }
 *
 * Toggles the caller's `profiles.sms_notifications_enabled` (the opt-out for
 * important-notification SMS). Authenticated via the SSR cookie, then written
 * with the service-role client so it doesn't depend on a profiles self-update
 * RLS policy — the route only ever updates the caller's own row.
 *
 * Each switch is also an answer in `user_consents` (kind « sms », 0182), so
 * the account page can say when SMS were accepted or refused.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });

  let enabled: boolean | null = null;
  try {
    const body = (await req.json()) as { enabled?: unknown };
    if (typeof body.enabled === "boolean") enabled = body.enabled;
  } catch {
    /* falls through to 400 */
  }
  if (enabled === null) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const { error } = await admin
    .from("profiles")
    .update({ sms_notifications_enabled: enabled })
    .eq("id", user.id);
  if (error) {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }
  const { legal_version } = await getSettings();
  await recordConsents(admin, user.id, [{ kind: "sms", granted: enabled }], legal_version, "settings");
  return NextResponse.json({ ok: true, enabled });
}
