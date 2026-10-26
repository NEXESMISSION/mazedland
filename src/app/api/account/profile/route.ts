import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { apiTranslator } from "@/lib/i18n/server";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

/**
 * POST /api/account/profile  { full_name, governorate }
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

  const body = (await req.json().catch(() => ({}))) as { full_name?: unknown; governorate?: unknown };
  const name = typeof body.full_name === "string" ? body.full_name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) {
    const t = await apiTranslator(req, "accountSettings");
    return NextResponse.json({ ok: false, error: "bad_name", detail: t("nameInvalid") }, { status: 400 });
  }
  const gov =
    typeof body.governorate === "string" && (TUNISIAN_GOVERNORATES as readonly string[]).includes(body.governorate)
      ? body.governorate
      : null;

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const { error } = await admin.from("profiles").update({ full_name: name, governorate: gov }).eq("id", user.id);
  if (error) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
