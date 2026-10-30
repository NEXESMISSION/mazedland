import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time CRON_SECRET compare. A plain `provided !== secret`
 * short-circuits on the first differing byte, leaking the secret's length /
 * prefix through response timing. timingSafeEqual needs equal-length buffers,
 * so we length-check first (length alone is not the byte-by-byte oracle this
 * removes). Shared by ALL cron routes so the one shared secret is compared in
 * constant time everywhere — previously only the tick route was hardened.
 */
export function secretMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate the cron shared secret: `Authorization: Bearer <secret>`, as Vercel
 * sends it and as the pg_cron jobs send it from the Vault (0158, 0200, 0201).
 * A `?key=` in the URL is not accepted any more: it ended up in every request
 * log. Returns a NextResponse to return IMMEDIATELY on failure (503 if
 * unset, 403 if wrong), or null when the caller is authorized.
 *
 *   const denied = verifyCronSecret(req);
 *   if (denied) return denied;
 */
export function verifyCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secretMatches(provided, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
