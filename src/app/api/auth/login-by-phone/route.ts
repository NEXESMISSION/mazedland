import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { assertSupabaseRef } from "@/lib/supabase/guard";

/**
 * Phone sign-in — fully server-side.
 *
 *   Body: { phone: "+216…" (E.164), password: string }
 *   200:  { ok: true }   (auth cookie set on the response)
 *   401:  { ok: false, error: "invalid_credentials" }   (generic — never
 *         distinguishes "no account for this phone" from "wrong password", so
 *         it can't be used to enumerate accounts or harvest emails)
 *
 * Replaces /api/auth/email-by-phone, which returned the account's real email to
 * any anonymous caller who knew a phone number (disclosure + enumeration
 * oracle). Here the phone→email resolution AND the sign-in both happen
 * server-side with the service-role key; the email never crosses to the client.
 * signInWithPassword on the SSR client writes the auth cookie onto this
 * response (same mechanism as /api/auth/signout), so the client just reloads.
 */
const BUCKET = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (BUCKET.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  BUCKET.set(ip, hits);
  if (BUCKET.size > 5000) {
    for (const [k, v] of BUCKET) if (v.every((t) => now - t > WINDOW_MS)) BUCKET.delete(k);
  }
  return hits.length > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_origin_blocked" }, { status: 403 });
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let phone = "";
  let password = "";
  try {
    const body = (await req.json()) as { phone?: unknown; password?: unknown };
    if (typeof body.phone === "string") phone = body.phone.trim();
    if (typeof body.password === "string") password = body.password;
  } catch {
    /* fall through to the generic 401 below */
  }
  if (!phone || phone.length > 16 || !/^\+\d{6,15}$/.test(phone) || !password) {
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 500 });
  }
  assertSupabaseRef(url); // refuse to act against a sibling app's DB
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Cross-instance rate limit (per-IP) — hardens against enumeration.
  const { data: blocked } = await admin.rpc("check_auth_ratelimit", { p_ip: ip });
  if (blocked === true) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // Per-PHONE cap — protects a specific account from brute-force spread across
  // many IPs (the per-IP cap alone can't). 10 attempts / 15 min per number.
  const { data: phoneBlocked } = await admin.rpc("check_rate_limit", {
    p_key: `login:${phone}`,
    p_max: 10,
    p_window_secs: 900,
  });
  if (phoneBlocked === true) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // Resolve phone → email server-side. The email is NEVER returned.
  let email: string | null = null;
  const { data: profile } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (profile?.id) {
    const { data: userRes } = await admin.auth.admin.getUserById(profile.id);
    email = userRes?.user?.email ?? null;
  }
  if (!email) {
    // Unknown phone — same generic failure as a wrong password (no oracle).
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }

  // Sign in server-side; the SSR client writes the auth cookie onto the response.
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
