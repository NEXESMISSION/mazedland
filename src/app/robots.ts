import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

const SITE_URL = siteUrl();

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
          "/fr/admin",
          "/fr/account",
          "/fr/payment",
          "/fr/login",
          "/fr/signup",
          "/fr/forgot-password",
          "/fr/reset-password",
        ],
      },
    ],
    sitemap: SITE_URL ? `${SITE_URL}/sitemap.xml` : undefined,
    host: SITE_URL ?? undefined,
  };
}
