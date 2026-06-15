import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isSameOrigin } from "@/lib/sameOrigin";
import { assertSupabaseRef } from "@/lib/supabase/guard";
import { clientIp } from "@/lib/clientIp";
import { isSmsConfigured } from "@/lib/winsms";

/**
 * Phone-OTP password reset — fully server-side.
 *
 *   Body: { phone: "+216…" (E.164), password }
 *   200:  { ok: true }   (password updated; user can sign in with it)
 *   400:  { ok:false, error:"invalid_phone" | "weak_password" | "bad_request" | "reset_failed" }
 *   403:  { ok:false, error:"phone_not_verified" }   (no fresh OTP proof)
 *   404:  { ok:false, error:"no_account" }
 *   429:  { ok:false, error:"rate_limited" }
 *   503:  { ok:false, error:"sms_not_configured" }
 *
 * The caller must FIRST pass /api/auth/phone/send + /api/auth/phone/verify,
 * which stamp a short-lived `verified_at` proof on phone_otps. This route
 * re-checks that proof server-side (the client never holds a recovery token),
 * resolves phone→user, admin-updates the password, then consumes the proof.
 *
 * Reset is SMS-only: a phone-only account has no other ownership channel, so
 * with SMS off this returns 503 (there is nothing to verify against).
 */
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross_origin_blocked" }, { status: 403 });
  }
  const ip = clientIp(req);

  let phone = "";
  let password = "";
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.phone === "string") phone = body.phone.trim();
    if (typeof body.password === "string") password = body.password;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (!phone || phone.length > 16 || !/^\+\d{6,15}$/.test(phone)) {
    return NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ ok: false, error: "weak_password" }, { status: 400 });
  }

  // SMS-only recovery — without it there is no ownership proof to check.
  if (!isSmsConfigured()) {
    return NextResponse.json({ ok: false, error: "sms_not_configured" }, { status: 503 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 500 });
  }
  assertSupabaseRef(url); // refuse to act against a sibling app's DB
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Cross-instance rate limits: per-IP + per-phone (mirror login-by-phone).
  const { data: blocked } = await admin.rpc("check_auth_ratelimit", { p_ip: ip });
  if (blocked === true) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const { data: phoneBlocked } = await admin.rpc("check_rate_limit", {
    p_key: `reset:${phone}`,
    p_max: 10,
    p_window_secs: 900,
  });
  if (phoneBlocked === true) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // Require a fresh OTP proof stamped by /api/auth/phone/verify.
  const { data: otp } = await admin
    .from("phone_otps")
    .select("verified_at")
    .eq("phone", phone)
    .maybeSingle();
  const verifiedMs = otp?.verified_at ? new Date(otp.verified_at as string).getTime() : 0;
  if (!verifiedMs || Date.now() - verifiedMs > VERIFY_WINDOW_MS) {
    return NextResponse.json({ ok: false, error: "phone_not_verified" }, { status: 403 });
  }

  // Resolve phone → user. The caller already proved they own this phone (they
  // received the OTP), so telling them there's no account for it is not a
  // useful enumeration oracle.
  const { data: profile } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (!profile?.id) {
    return NextResponse.json({ ok: false, error: "no_account" }, { status: 404 });
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(profile.id as string, { password });
  if (updErr) {
    return NextResponse.json({ ok: false, error: "reset_failed" }, { status: 400 });
  }

  // Consume the proof so it can't be reused for another reset.
  await admin.from("phone_otps").delete().eq("phone", phone);
  return NextResponse.json({ ok: true });
}
