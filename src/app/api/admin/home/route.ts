import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * POST /api/admin/home — admin curation of home/search placements.
 * Body: { propertyId, home_featured, top_listed, banner, days }
 *
 * Sets the property's promo flags directly (free admin override) and a
 * single promo_expires_at = now() + days (0/empty = no expiry). All flags
 * false → unfeature (clears flags + expiry + manual). Manually-set
 * placements are tagged promo_manual=true so the UI can show Manuel vs Payé.
 */
export async function POST(req: NextRequest) {
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
  const propertyId = body.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId_required" }, { status: 400 });

  const home = body.home_featured === true;
  const top = body.top_listed === true;
  const banner = body.banner === true;
  const anyOn = home || top || banner;
  const days = Math.max(0, Math.min(365, Number(body.days) || 0));

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const expires =
    anyOn && days > 0
      ? new Date(Date.now() + days * 86_400_000).toISOString()
      : null;

  const { error } = await admin
    .from("properties")
    .update({
      promo_home_featured: home,
      promo_top_listed: top,
      promo_banner: banner,
      promo_expires_at: expires,
      promo_manual: anyOn, // true when an admin curated it (vs paid)
    })
    .eq("id", propertyId)
    .eq("status", "ready");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
