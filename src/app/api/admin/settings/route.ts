import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

const NUMERIC_KEYS = [
  "listing_fee_tnd",
  "promo_home_featured_tnd",
  "promo_top_listed_tnd",
  "promo_banner_tnd",
] as const;
const TEXT_KEYS = [
  "payee_name",
  "payee_bank",
  "payee_rib",
  "payee_iban",
  "payee_d17",
] as const;

/**
 * PUT /api/admin/settings — bulk update tunable prices + payee fields.
 *
 * Admin-only. Coerces inputs: numeric keys clamp to [0, 100000]; text
 * keys trim + cap at 200 chars. Anything not in the allowlist is
 * ignored to keep the surface tight.
 */
export async function PUT(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rows: { key: string; value: unknown; updated_by: string }[] = [];

  for (const key of NUMERIC_KEYS) {
    if (!(key in body)) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      return NextResponse.json(
        { error: "invalid_number", key },
        { status: 400 },
      );
    }
    rows.push({ key, value: n, updated_by: user.id });
  }
  for (const key of TEXT_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "invalid_text", key }, { status: 400 });
    }
    const v = raw.trim().slice(0, 200);
    rows.push({ key, value: v, updated_by: user.id });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { error } = await admin
    .from("app_settings")
    .upsert(rows, { onConflict: "key" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: rows.length });
}
