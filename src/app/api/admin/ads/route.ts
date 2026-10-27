import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { parseAdInput } from "@/lib/ads/input";

/**
 * The advertising campaigns (0177), for /admin/publicites.
 *
 *   GET  → every ad, the ended and the paused included: their report is
 *          what the advertiser asks for after the campaign
 *   POST → create one. The dates come as days (`starts_on`, `ends_on`, both
 *          included, Tunis time) and the images as paths the upload route
 *          minted (`ads/<uuid>.<ext>`).
 *
 * Admin-only, through the service role: `ads` is closed to every client role.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, "publicites");
  if (gate instanceof NextResponse) return gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data, error } = await admin
    .from("ads")
    .select("*")
    .order("placement", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) return fail("ads_read_failed", 500, error);
  return NextResponse.json({ ads: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "publicites");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = parseAdInput(body, { partial: false });
  if (!parsed.ok) {
    const t = await apiTranslator(req, "adminAds.api");
    return NextResponse.json({ error: "invalid", field: parsed.error, detail: t(parsed.error) }, { status: 400 });
  }

  const { data, error } = await admin
    .from("ads")
    .insert({ ...parsed.value, created_by: user.id })
    .select("id")
    .single();
  if (error) return fail("ad_create_failed", 500, error);

  logAction(req, user, "admin.ad.create", {
    id: data.id,
    advertiser: parsed.value.advertiser,
    placement: parsed.value.placement,
  });
  return NextResponse.json({ ok: true, id: data.id });
}
