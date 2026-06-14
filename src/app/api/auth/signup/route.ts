import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { assertSupabaseRef } from "@/lib/supabase/guard";
import { clientIp } from "@/lib/clientIp";
import { isSmsConfigured } from "@/lib/winsms";

/**
 * Phone-only signup — fully server-side.
 *
 *   Body: { phone: "+216…" (E.164), password, full_name, governorate }
 *   200:  { ok: true }   (account created + signed in; auth cookie on response)
 *   400:  { ok: false, error: "invalid_phone" | "weak_password" | "bad_request" | "signup_failed" }
 *   409:  { ok: false, error: "phone_taken" }
 *   429:  { ok: false, error: "rate_limited" }
 *
 * Email auth was dropped. Supabase still needs an identifier, so we mint a
 * synthetic, PRE-CONFIRMED email from the phone (no real inbox, never shown to
 * the user). The unique auth.users.email on that synthetic address doubles as a
 * one-account-per-phone guard. The `_on_auth_user_created` trigger copies
 * full_name / phone / governorate into public.profiles. After creation we sign
 * the user in on the SSR client so the auth cookie is written onto the response
 * (same mechanism as /api/auth/login-by-phone) and the client hard-navigates.
 *
 * SMS confirmation is future work — accounts are active immediately (the
 * synthetic email is pre-confirmed). The signup form's optional WinSMS OTP gate
 * still runs in front of this when configured.
 */

// Synthetic email domain for phone accounts. Nothing is ever sent here; the
// address only exists so Supabase has a unique handle. Per-app default, but
// override with SIGNUP_EMAIL_DOMAIN to point at a domain you actually OWN
// (audit #16/#19 — the hardcoded default isn't owned, a latent recovery/
// takeover vector if email-based recovery is ever turned on).
const PHONE_EMAIL_DOMAIN = process.env.SIGNUP_EMAIL_DOMAIN || "phone.mazedland.app";

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
  let fullName = "";
  let governorate = "";
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.phone === "string") phone = body.phone.trim();
    if (typeof body.password === "string") password = body.password;
    if (typeof body.full_name === "string") fullName = body.full_name.trim();
    if (typeof body.governorate === "string") governorate = body.governorate.trim();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  // Phone must already be normalized E.164 by the client (normalizeE164).
  if (!phone || phone.length > 16 || !/^\+\d{6,15}$/.test(phone)) {
    return NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ ok: false, error: "weak_password" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 500 });
  }
  assertSupabaseRef(url); // refuse to act against a sibling app's DB
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Cross-instance rate limit (per-IP) — hardens against abuse.
  const { data: blocked } = await admin.rpc("check_auth_ratelimit", { p_ip: ip });
  if (blocked === true) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // One account per phone — friendly pre-check. (The unique synthetic email
  // below is the actual race-safe guard at the auth layer.)
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing?.id) {
    return NextResponse.json({ ok: false, error: "phone_taken" }, { status: 409 });
  }

  // Fail CLOSED when SMS is configured: require a recent phone-verification
  // proof (audit #2 — the OTP gate was client-only + fail-open, so a script
  // could POST here and register any phone). When SMS is OFF (today), skip —
  // accounts are unverified by design until SMS is wired, which is acceptable.
  if (isSmsConfigured()) {
    const { data: otp } = await admin
      .from("phone_otps")
      .select("verified_at")
      .eq("phone", phone)
      .maybeSingle();
    const verifiedMs = otp?.verified_at ? new Date(otp.verified_at as string).getTime() : 0;
    if (!verifiedMs || Date.now() - verifiedMs > 15 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: "phone_not_verified" }, { status: 403 });
    }
  }

  const email = `${phone.replace(/\D/g, "")}@${PHONE_EMAIL_DOMAIN}`;
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName || null,
      phone,
      governorate: governorate || null,
    },
  });
  if (createErr) {
    // A duplicate synthetic email means this phone is already registered (race
    // with the pre-check above, or a malformed legacy row).
    const msg = createErr.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exist")) {
      return NextResponse.json({ ok: false, error: "phone_taken" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "signup_failed" }, { status: 400 });
  }

  // Sign in server-side; the SSR client writes the auth cookie onto the response
  // so the client lands authenticated after a hard navigation.
  const supabase = await getServerSupabase();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // The account exists; the client can fall back to logging in by phone.
    return NextResponse.json({ ok: false, error: "signin_failed" }, { status: 500 });
  }
  // Consume the verification proof so it can't be reused for another signup.
  await admin.from("phone_otps").delete().eq("phone", phone);
  return NextResponse.json({ ok: true });
}
