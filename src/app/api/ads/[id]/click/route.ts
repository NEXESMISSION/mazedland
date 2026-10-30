import { NextRequest, NextResponse, after } from "next/server";
import { featureOff } from "@/lib/settings/gate";
import { clientIp } from "@/lib/clientIp";
import { countAdEvent, trackedAd } from "@/lib/ads/server";

/**
 * GET /api/ads/[id]/click — a visitor tapped a banner: count it, and send
 * them to the advertiser.
 *
 * The banner links here rather than to the advertiser so the click is counted
 * by us, the number the advertiser is billed on, without a script in the way
 * of the tap. The address it redirects to is read from the ad, never from the
 * request: a redirect that takes its target from the URL is an open redirect
 * on our domain. And only http/https (safeAdLink), checked again here because
 * a row written before the check would otherwise still be followed.
 *
 * The visitor is not kept waiting on the count: the redirect goes first and
 * the click is recorded after it (`after()`). Only a GET is a tap: see HEAD.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_ads");
  if (off) return off;

  const { id } = await ctx.params;
  const ad = await trackedAd(id);
  if (!ad) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ip = clientIp(req);
  after(() => countAdEvent(ip, ad, "click").catch(() => {}));

  return sendTo(ad.link);
}

/**
 * A HEAD is a link checker, an uptime monitor or a chat app making its
 * preview, not a visitor: it gets the same redirect and no click is counted
 * on it. Without a handler of its own Next served HEAD with GET, click
 * included — on the number the advertiser is billed on.
 */
export async function HEAD(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_ads");
  if (off) return off;

  const { id } = await ctx.params;
  const ad = await trackedAd(id);
  if (!ad) return new NextResponse(null, { status: 404 });

  return sendTo(ad.link);
}

function sendTo(link: string) {
  const res = NextResponse.redirect(link, 302);
  // Every tap must reach us to be counted: no browser or CDN keeps this answer.
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
