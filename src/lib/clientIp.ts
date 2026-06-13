import type { NextRequest } from "next/server";

/**
 * Best-effort REAL client IP for rate limiting (audit #6/#9).
 *
 * The leftmost `x-forwarded-for` entry is ATTACKER-CONTROLLED: a client can send
 * its own `X-Forwarded-For` header and the platform appends the real connecting
 * IP to the RIGHT. So keying a rate limit on `xff.split(",")[0]` lets an attacker
 * rotate a fake leftmost value per request and bypass the cap entirely.
 *
 * Prefer the headers the platform sets itself and a client cannot forge:
 *   1. `x-vercel-forwarded-for` — Vercel-set, leftmost is the real client IP.
 *   2. `x-real-ip`             — Vercel-set to the real client IP.
 *   3. `x-forwarded-for` LAST hop — the entry added by the trusted edge proxy,
 *      not the client-controlled first one.
 * Falls back to "anonymous" (local/dev) so the limiter still has a stable key.
 */
export function clientIp(req: NextRequest): string {
  const h = req.headers;
  const vercel = h.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!; // trusted last hop
  }
  return "anonymous";
}
