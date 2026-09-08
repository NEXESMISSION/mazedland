import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * POST /api/admin/home — admin curation of home/search placements.
 * Body: { listingId, home_featured, top_listed, banner, days }
 *
 * Sets the annonce's promo flags directly (free admin override) and a
 * single promo_expires_at = now() + days (0/empty = no expiry). All flags
 * false → unfeature (clears flags + expiry + manual). Manually-set
 * placements are tagged promo_manual=true so the UI can show Manuel vs Payé.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  // Accepts the old `propertyId` key as well: the client component sent it
  // until this route moved to `listings`, and a stale bundle in someone's tab
  // should curate a listing rather than 400.
  const listingId = (body.listingId ?? body.propertyId) as string | undefined;
  if (!listingId) return NextResponse.json({ error: "listingId_required" }, { status: 400 });

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
    .from("listings")
    .update({
      promo_home_featured: home,
      promo_top_listed: top,
      promo_banner: banner,
      promo_expires_at: expires,
      promo_manual: anyOn, // true when an admin curated it (vs paid)
    })
    .eq("id", listingId)
    .eq("status", "ready");
  if (error) return fail("home_feature_failed", 500, error);

  // Promo flags drive home/explore feed ordering — refresh both immediately.
  revalidateTag("home-feed", "max");
  revalidateTag("explore-feed", "max");

  logAction(req, user, "home.feature", { listingId, home, top, banner });
  return NextResponse.json({ ok: true });
}
