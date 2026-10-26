import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * POST /api/account/language  { language: "fr" | "ar" }
 *
 * Records the language a signed-in user switched to in `profiles.language`, so
 * the SMS and e-mail drains write to them in it (the site itself follows the
 * URL and the NEXT_LOCALE cookie). Called by the language switcher; a visitor
 * who is not signed in gets a 401 the switcher ignores. Same shape as
 * /api/account/sms-pref: the SSR cookie authenticates, the service role writes
 * the caller's own row only.
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

  let language: "fr" | "ar" | null = null;
  try {
    const body = (await req.json()) as { language?: unknown };
    if (body.language === "fr" || body.language === "ar") language = body.language;
  } catch {
    /* falls through to 400 */
  }
  if (!language) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const { error } = await admin.from("profiles").update({ language }).eq("id", user.id);
  if (error) {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, language });
}
