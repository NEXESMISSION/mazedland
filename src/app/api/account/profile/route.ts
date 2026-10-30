import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { apiTranslator } from "@/lib/i18n/server";
import { governorateChoice } from "@/lib/tunisia";

/**
 * POST /api/account/profile  { full_name, governorate? }
 *
 * The two things a person may change about themselves after signup: the name
 * an annonce shows by default, and the governorate the publish form starts
 * from. Same shape as /api/account/language: the session authenticates, the
 * service role writes the caller's own row, and nothing else on it (role,
 * phone, ban) is reachable from here.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });

  const body = (await jsonObject(req)) as { full_name?: unknown; governorate?: unknown };
  const name = typeof body.full_name === "string" ? body.full_name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) {
    const t = await apiTranslator(req, "accountSettings");
    return NextResponse.json({ ok: false, error: "bad_name", detail: t("nameInvalid") }, { status: 400 });
  }
  // Only what was sent is written. A name-only body, or a governorate of the
  // wrong type, used to be read as « none » and erased the stored one; only
  // the empty choice ('' or null) clears it, and an unknown name is refused.
  const patch: { full_name: string; governorate?: string | null } = { full_name: name };
  if (body.governorate !== undefined) {
    const choice = governorateChoice(body.governorate);
    if (!choice.ok) {
      const t = await apiTranslator(req, "accountSettings");
      return NextResponse.json({ ok: false, error: "bad_governorate", detail: t("governorateInvalid") }, { status: 400 });
    }
    patch.governorate = choice.value;
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const { error } = await admin.from("profiles").update(patch).eq("id", user.id);
  if (error) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
