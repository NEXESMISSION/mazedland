import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { routing } from "@/i18n/routing";
import { projectsShown } from "@/lib/pro/projectsServer";

const SITE_URL = siteUrl();

// Regenerate at most hourly — listings change on the order of minutes, and a
// search crawler doesn't need second-fresh URLs. Keeps the DB read off the
// hot path.
export const revalidate = 3600;

/**
 * Every page in every locale, each entry naming its translations so a search
 * engine serves the French or the Arabic one to the right reader.
 */
function localized(
  base: string,
  path: string,
  extra: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">,
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`]));
  return routing.locales.map((l) => ({ url: `${base}/${l}${path}`, alternates: { languages }, ...extra }));
}

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
    ...localized(base, "", { changeFrequency: "hourly", priority: 1 }),
    // /annonces, not /properties: /properties 302s to /annonces since the
    // pivot, and a sitemap that lists a redirect wastes crawl budget on it.
    ...localized(base, "/annonces", { changeFrequency: "hourly", priority: 0.9 }),
    ...localized(base, "/terms", { changeFrequency: "yearly", priority: 0.2 }),
    ...localized(base, "/privacy", { changeFrequency: "yearly", priority: 0.2 }),
    ...localized(base, "/contact", { changeFrequency: "monthly", priority: 0.3 }),
    // Pro (0173): what it is, and the directory of open shops.
    ...localized(base, "/pro", { changeFrequency: "monthly", priority: 0.5 }),
    ...localized(base, "/agences", { changeFrequency: "daily", priority: 0.6 }),
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

    const listingRoutes: MetadataRoute.Sitemap = (data ?? []).flatMap((row) => {
      const r = row as {
        id: string;
        updated_at: string | null;
        created_at: string | null;
        published_at: string | null;
      };
      return localized(base, `/annonces/${r.id}`, {
        lastModified: r.updated_at ?? r.published_at ?? r.created_at ?? undefined,
        // A fixed price does not tick. Daily is honest for a catalogue where a
        // seller edits a price or takes an annonce down.
        changeFrequency: "daily" as const,
        priority: 0.7,
      });
    });

    // Each open shop's page (0173).
    const { data: shops } = await sb.from("shops").select("slug, updated_at").eq("status", "approved").limit(2000);
    const shopRoutes: MetadataRoute.Sitemap = ((shops ?? []) as { slug: string; updated_at: string | null }[]).flatMap((s) =>
      localized(base, `/agences/${s.slug}`, { lastModified: s.updated_at ?? undefined, changeFrequency: "daily" as const, priority: 0.6 }),
    );

    // Each published project (0179) whose agence may show it right now.
    const { data: projects } = await sb
      .from("projects")
      .select("slug, updated_at, shop:shops!inner (id, slug, status)")
      .eq("status", "published")
      .eq("shop.status", "approved")
      .limit(2000);
    const shown = new Map<string, boolean>();
    const projectRoutes: MetadataRoute.Sitemap = [];
    for (const p of (projects ?? []) as unknown as { slug: string; updated_at: string | null; shop: { id: string; slug: string } }[]) {
      if (!shown.has(p.shop.id)) shown.set(p.shop.id, await projectsShown(sb, p.shop.id));
      if (!shown.get(p.shop.id)) continue;
      projectRoutes.push(
        ...localized(base, `/agences/${p.shop.slug}/projets/${p.slug}`, { lastModified: p.updated_at ?? undefined, changeFrequency: "daily" as const, priority: 0.6 }),
      );
    }

    return [...staticRoutes, ...shopRoutes, ...projectRoutes, ...listingRoutes];
  } catch {
    // Never let a DB hiccup 500 the sitemap — degrade to static routes.
    return staticRoutes;
  }
}
