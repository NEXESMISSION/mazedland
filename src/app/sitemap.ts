import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

const SITE_URL = siteUrl();

// Regenerate at most hourly — listings change on the order of minutes, and a
// search crawler doesn't need second-fresh URLs. Keeps the DB read off the
// hot path.
export const revalidate = 3600;

/**
 * Dynamic sitemap. Public, crawlable surfaces only:
 *   - the static pages and the catalogue
 *   - every published annonce
 *
 * Authenticated areas (admin / account / payment) are excluded here and in
 * robots.ts. Uses the cookieless service-role client like the home feed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL ?? "";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/fr`, changeFrequency: "hourly", priority: 1 },
    // /fr/annonces, not /fr/properties: /properties 302s to /annonces since the
    // pivot, and a sitemap that lists a redirect wastes crawl budget on it.
    { url: `${base}/fr/annonces`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/fr/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/fr/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/fr/contact`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const sb = getServiceSupabase();
  if (!sb || !base) return staticRoutes;

  try {
    // `auctions` joined to `properties`, filtered to `status = 'ready'`, until
    // migration 0153 dropped both. The catch below swallowed the resulting
    // error and returned only the static routes — so since that migration, not
    // one annonce has been in the sitemap. Silent, and exactly the shape of
    // failure a try/catch around a whole query produces.
    const { data, error } = await sb
      .from("listings")
      .select("id, updated_at, created_at, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(5000);

    // Logged rather than swallowed. A sitemap that quietly shrinks to six
    // static URLs is worse than one that fails loudly, because nothing
    // downstream notices for weeks.
    if (error) {
      log.scope("sitemap").error("listing query failed", { msg: error.message });
      return staticRoutes;
    }

    const listingRoutes: MetadataRoute.Sitemap = (data ?? []).map((row) => {
      const r = row as {
        id: string;
        updated_at: string | null;
        created_at: string | null;
        published_at: string | null;
      };
      return {
        url: `${base}/fr/annonces/${r.id}`,
        lastModified: r.updated_at ?? r.published_at ?? r.created_at ?? undefined,
        // A fixed price does not tick. Daily is honest for a catalogue where a
        // seller edits a price or takes an annonce down.
        changeFrequency: "daily" as const,
        priority: 0.7,
      };
    });

    return [...staticRoutes, ...listingRoutes];
  } catch {
    // Never let a DB hiccup 500 the sitemap — degrade to static routes.
    return staticRoutes;
  }
}
