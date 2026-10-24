type Env = Record<string, string | undefined>;

/**
 * Mazed Immo's own address. mazed.immo answers with a redirect to www, so the
 * links the site writes (SMS, e-mails, social posts, canonical tags) go
 * straight to www.
 */
export const PRODUCTION_ORIGIN = "https://www.mazed.immo";

const isVercelApp = (urlOrHost: string) => /(^|\/\/|\.)vercel\.app(\/|:|$)/i.test(urlOrHost);

/**
 * The site's public origin — "https://example.tn", no trailing slash — or null
 * when there is nothing true to say.
 *
 *   1. NEXT_PUBLIC_SITE_URL, once a domain exists. Skipped on Vercel when it
 *      names localhost: that is a .env.local value copied into the project.
 *      Skipped in production when it names a *.vercel.app host: a message or
 *      a post must carry the real domain, not the hosting one.
 *   2. On a Vercel production deployment, VERCEL_PROJECT_PRODUCTION_URL — the
 *      project's production hostname, the same from one deployment to the
 *      next — when it is a custom domain; PRODUCTION_ORIGIN otherwise. SMS
 *      went out with mazedland.vercel.app links because nothing more
 *      specific was configured.
 *   3. On a Vercel preview, VERCEL_BRANCH_URL, then VERCEL_URL.
 *
 * Never VERCEL_URL in production. It names the single deployment being built,
 * so a canonical link or sitemap entry made from it changes with every push and
 * points search engines at an address that is replaced the next day.
 *
 * With none of them — a local `next start` — callers leave the origin out
 * rather than invent a domain.
 */
export function siteUrl(env: Env = process.env): string | null {
  const production = Boolean(env.VERCEL) && env.VERCEL_ENV === "production";
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (
    explicit &&
    !(env.VERCEL && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(explicit)) &&
    !(production && isVercelApp(explicit))
  ) {
    return explicit;
  }
  if (!env.VERCEL) return null;
  if (production) {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL;
    return host && !isVercelApp(host) ? `https://${host}` : PRODUCTION_ORIGIN;
  }
  const host = env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/** `path` on the site as an absolute URL; unchanged when the origin is unknown. */
export function absoluteUrl(path: string, env: Env = process.env): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = siteUrl(env);
  if (!base) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}
