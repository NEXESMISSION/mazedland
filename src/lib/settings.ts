import { unstable_cache } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import {
  parseMonetizationSettings,
  parseAntiSnipe,
  type MonetizationSettings,
  type AntiSnipeSettings,
} from "@/lib/pricing";

/**
 * Cached read layer for `app_settings` (admin-controlled monetization +
 * anti-snipe config). These values change only when an admin saves the
 * settings form — minutes-to-days apart — yet every auction detail view,
 * bid page, checkout and sell render used to fire a fresh DB round-trip for
 * them. On a busy marketplace that's one wasted query per request on the
 * hottest pages.
 *
 * We cache the whole key→value map with `unstable_cache` (cookieless,
 * service-role read — same pattern as the home feed) and invalidate it the
 * instant an admin saves via `revalidateTag(APP_SETTINGS_TAG, "max")` in
 * the settings PUT handler. So values stay fully admin-parametrable AND fresh,
 * while the per-request DB read disappears.
 *
 * NOTE: the money-charging paths — the checkout page's authoritative
 * amount computation, the deposit route, and the initiate-payment route —
 * intentionally still read app_settings directly. They are the authoritative
 * charge points and must never act on a cached value.
 */
export const APP_SETTINGS_TAG = "app-settings";

// Every key any caller reads out of app_settings. One cached fetch covers
// them all, so adding a consumer never adds a round-trip.
const ALL_KEYS = [
  "fee_listing_auction",
  "fee_listing_direct",
  "promo_home",
  "promo_top",
  "promo_banner",
  "deposit",
  "auction_antisnipe",
] as const;

const getAppSettingsRecord = unstable_cache(
  async (): Promise<Record<string, unknown>> => {
    const sb = getServiceSupabase();
    if (!sb) return {};
    const { data } = await sb
      .from("app_settings")
      .select("key, value")
      .in("key", ALL_KEYS as unknown as string[]);
    const rec: Record<string, unknown> = {};
    for (const row of data ?? []) {
      const r = row as { key: string; value: unknown };
      rec[r.key] = r.value;
    }
    return rec;
  },
  ["app-settings"],
  { revalidate: 300, tags: [APP_SETTINGS_TAG] },
);

/** Cached app_settings as the key→value Map that pricing.ts parsers expect. */
export async function getCachedAppSettingsMap(): Promise<Map<string, unknown>> {
  const rec = await getAppSettingsRecord();
  return new Map(Object.entries(rec));
}

/** Full typed monetization config (fees, promos, deposit) — cached. */
export async function getCachedMonetization(): Promise<MonetizationSettings> {
  return parseMonetizationSettings(await getCachedAppSettingsMap());
}

/** Anti-snipe (auction time-extension) config — cached. */
export async function getCachedAntiSnipe(): Promise<AntiSnipeSettings> {
  const rec = await getAppSettingsRecord();
  return parseAntiSnipe(rec["auction_antisnipe"]);
}
