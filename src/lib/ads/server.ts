/**
 * The banners a page shows, read on the server.
 *
 * `ads` is closed to the client roles (0177): the public reads it here, with
 * the service role, and only the columns a banner needs — never the link
 * (the click route resolves it) and never the counts.
 *
 * Once per request and placement (React `cache`): a page with two slots of
 * the same placement costs one query. Never throws — an advertising slot
 * that fails is an empty slot, not a broken page.
 */
import { cache } from "react";
import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { isLive, safeAdLink, type AdPlacement, type AdTiming, type PublicAd } from "./ads";

const adsLog = log.scope("ads");

/** More would never be seen: a slot rotates every few seconds. */
const MAX_PER_SLOT = 12;

export const PUBLIC_AD_COLUMNS =
  "id, advertiser, title, title_ar, image_path, image_mobile_path, active, starts_at, ends_at";

export const liveAds = cache(async (placement: AdPlacement): Promise<PublicAd[]> => {
  const admin = getServiceSupabase();
  if (!admin) return [];
  const now = new Date();
  // Ended campaigns stay in the table for their report; the database drops
  // those, and isLive below settles the rest (paused, not started yet) with
  // the same rule the console shows.
  const { data, error } = await admin
    .from("ads")
    .select(PUBLIC_AD_COLUMNS)
    .eq("placement", placement)
    .eq("active", true)
    .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_PER_SLOT * 2);
  if (error) {
    adsLog.warn("live ads read failed", { placement, msg: error.message });
    return [];
  }
  return ((data ?? []) as PublicAd[]).filter((ad) => isLive(ad, now)).slice(0, MAX_PER_SLOT);
});

// ─── Views and clicks ───────────────────────────────────────────────────────

/**
 * How many events one address may add in an hour. Generous, because a
 * Tunisian mobile network puts a whole neighbourhood behind one address:
 * a view is one banner seen once per page, so 600 is a long evening of
 * browsing for a crowd. A click is per banner — the same person clicking the
 * same ad ten times is one interested person, not ten.
 */
const LIMITS = {
  view: { max: 600, key: (_ad: string, ip: string) => `ad-view:${ip}` },
  click: { max: 10, key: (ad: string, ip: string) => `ad-click:${ad}:${ip}` },
} as const;

/** The address, hashed with a server secret as the annonce views are: the
 *  rate-limit table must never become a list of who saw what from where. */
function hashIp(ip: string): string {
  const salt = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "mazed";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ad behind a tracking URL, and the link a click goes to. Null when
 *  there is no such ad, or its link is not one we redirect to. */
export async function trackedAd(id: string): Promise<{ id: string; link: string; live: boolean } | null> {
  const admin = getServiceSupabase();
  if (!admin || !UUID.test(id)) return null;
  const { data } = await admin
    .from("ads")
    .select("id, link_url, active, starts_at, ends_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const link = safeAdLink(data.link_url);
  if (!link) return null;
  return { id: data.id as string, link, live: isLive(data as AdTiming, new Date()) };
}

/**
 * Count one view or one click. Only while the campaign runs: a tab left open
 * on a banner that has since ended is not what the advertiser paid for. Past
 * the hourly limit it is quietly not counted — the visitor notices nothing.
 *
 * `ip` is `clientIp(req)`, read by the route before it answers: a click is
 * counted after the redirect has gone (`after()`), when the request is done.
 */
export async function countAdEvent(ip: string, ad: { id: string; live: boolean }, kind: "view" | "click"): Promise<void> {
  const admin = getServiceSupabase();
  if (!admin || !ad.live) return;
  const limit = LIMITS[kind];
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: limit.key(ad.id, hashIp(ip || "unknown")),
    p_max: limit.max,
    p_window_secs: 3600,
  });
  if (over === true) return;
  const { error } = await admin.rpc("record_ad_event", { p_ad: ad.id, p_kind: kind });
  if (error) adsLog.warn("ad event not recorded", { kind, msg: error.message });
}
