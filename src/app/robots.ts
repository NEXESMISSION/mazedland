import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";

const SITE_URL = siteUrl();

// Authenticated / transactional surfaces, kept out of the index in every locale.
const PRIVATE = ["/admin", "/account", "/payment", "/login", "/signup", "/forgot-password", "/reset-password"];

/**
 * /robots.txt — let crawlers index the public marketplace, keep them out of
 * the authenticated / transactional surfaces (no SEO value, and we don't want
 * admin or account URLs surfacing in search). Points at the dynamic sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          ...routing.locales.flatMap((l) => PRIVATE.map((p) => `/${l}${p}`)),
        ],
      },
    ],
    sitemap: SITE_URL ? `${SITE_URL}/sitemap.xml` : undefined,
    host: SITE_URL ?? undefined,
  };
}
