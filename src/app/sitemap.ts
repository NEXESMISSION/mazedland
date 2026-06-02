import type { MetadataRoute } from "next";
import { getServiceSupabase } from "@/lib/supabase/admin";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

// Regenerate at most hourly — listings change on the order of minutes, and a
// search crawler doesn't need second-fresh URLs. Keeps the DB read off the
// hot path.
export const revalidate = 3600;

/**
 * Dynamic sitemap. Public, crawlable surfaces only:
 *   - the static marketing/legal pages
 *   - every auction/listing whose property is `ready` and that is in a
 *     publicly-visible state (upcoming, live, or recently concluded)
 *
 * Authenticated areas (admin/account/kyc/payment/sell) are excluded here and
 * in robots.ts. Uses the cookieless service-role client like the home feed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL?.replace(/\/$/, "") ?? "";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/fr`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/fr/properties`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/fr/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/fr/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/fr/contact`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const sb = getServiceSupabase();
  if (!sb || !base) return staticRoutes;

  try {
    const { data } = await sb
      .from("auctions")
      .select("id, updated_at, created_at, status, property:properties!inner(status)")
      .eq("property.status", "ready")
      .in("status", ["scheduled", "live", "extending", "ended_sold", "awarded", "sixth_offer_window"])
      .order("created_at", { ascending: false })
      .limit(5000);

    const listingRoutes: MetadataRoute.Sitemap = (data ?? []).map((row) => {
      const r = row as { id: string; updated_at: string | null; created_at: string | null; status: string };
      const live = r.status === "live" || r.status === "extending";
      return {
        url: `${base}/fr/auctions/${r.id}`,
        lastModified: r.updated_at ?? r.created_at ?? undefined,
        changeFrequency: live ? "hourly" : "daily",
        priority: live ? 0.8 : 0.6,
      };
    });

    return [...staticRoutes, ...listingRoutes];
  } catch {
    // Never let a DB hiccup 500 the sitemap — degrade to static routes.
    return staticRoutes;
  }
}
