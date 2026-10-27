import { NextRequest, NextResponse } from "next/server";
import { featureOff } from "@/lib/settings/gate";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { countAdEvent, trackedAd } from "@/lib/ads/server";

/**
 * POST /api/ads/[id]/view — a banner was on screen: at least half of it, for
 * a second (AdRotator, by `navigator.sendBeacon`).
 *
 * Counted from the browser, not when the page renders: a banner below the
 * fold that nobody scrolled to, or in a slot rotating past it, was not seen,
 * and an advertiser paying for views is paying for the ones that were.
 *
 * Nothing here is worth an error on screen — a beacon never reads the answer.
 */
const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_ads");
  if (off) return off;
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const ad = await trackedAd(id);
  if (!ad) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await countAdEvent(clientIp(req), ad, "view");
  return ok();
}
