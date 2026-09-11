type Env = Record<string, string | undefined>;

/**
 * The site's public origin — "https://example.tn", no trailing slash — or null
 * when there is nothing true to say.
 *
 *   1. NEXT_PUBLIC_SITE_URL, once a domain exists. Skipped on Vercel when it
 *      names localhost: that is a .env.local value copied into the project.
 *   2. On a Vercel production deployment, VERCEL_PROJECT_PRODUCTION_URL — the
 *      project's production hostname, the same from one deployment to the next.
 *   3. On a Vercel preview, VERCEL_BRANCH_URL, then VERCEL_URL.
 *
 * Never VERCEL_URL in production. It names the single deployment being built,
 * so a canonical link or sitemap entry made from it changes with every push and
 * points search engines at an address that is replaced the next day. This is
 * the order Next itself uses for its default `metadataBase`.
 *
 * With none of them — a local `next start` — callers leave the origin out
 * rather than invent a domain.
 */
export function siteUrl(env: Env = process.env): string | null {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (explicit && !(env.VERCEL && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(explicit))) {
    return explicit;
  }
  if (!env.VERCEL) return null;
  const host =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/** `path` on the site as an absolute URL; unchanged when the origin is unknown. */
export function absoluteUrl(path: string, env: Env = process.env): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = siteUrl(env);
  if (!base) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}
