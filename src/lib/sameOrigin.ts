import type { NextRequest } from "next/server";

/**
 * Same-origin guard for mutating API routes (C8).
 *
 * The Supabase auth cookie is SameSite=lax which already blocks
 * cross-site POSTs in most cases. This adds a belt-and-suspenders
 * `Origin`/`Referer` check: a request without a matching Origin
 * (or a Referer header on the same host) is rejected so a logged-in
 * user can't be tricked into mutating their own data via a
 * cross-origin form submit / fetch from a malicious page.
 *
 * Webhooks and CRON endpoints opt out by not calling this helper —
 * they authenticate via shared secrets instead.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const u = new URL(origin);
      return u.host === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      return u.host === host;
    } catch {
      return false;
    }
  }

  // No Origin and no Referer — most likely a CLI / curl. Block by default.
  return false;
}
