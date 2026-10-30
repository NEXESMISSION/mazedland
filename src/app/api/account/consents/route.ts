import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { getSettings } from "@/lib/settings/server";
import { consentHistory, recordConsents } from "@/lib/consents/server";
import { currentConsents, needsLegalAcceptance } from "@/lib/consents/model";

export const dynamic = "force-dynamic";

/**
 * GET  /api/account/consents → { version, needsLegal }
 *      Whether the caller has accepted the CGU and privacy policy in force
 *      (`legal_version`). The banner asks only when `needsLegal`.
 * POST /api/account/consents  { accept: true }
 *      Records both, in that version, from the banner.
 */
export async function GET() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  const { legal_version } = await getSettings();
  const history = await consentHistory(supabase, user.id);
  return NextResponse.json(
    { ok: true, version: legal_version, needsLegal: needsLegalAcceptance(currentConsents(history), legal_version) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });

  const body = (await jsonObject(req)) as { accept?: unknown };
  if (body.accept !== true) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const { legal_version } = await getSettings();
  // Answering twice (two tabs) only adds a second row: it is still one answer.
  const ok = await recordConsents(
    admin,
    user.id,
    [{ kind: "terms", granted: true }, { kind: "privacy", granted: true }],
    legal_version,
    "banner",
  );
  if (!ok) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, version: legal_version });
}
