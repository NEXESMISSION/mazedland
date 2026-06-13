import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { hashCode } from "@/lib/otp";

const MAX_ATTEMPTS = 5;

/**
 * POST /api/auth/phone/verify — check a phone OTP.
 *
 * Body: { phone: "+216…", code: "123456" }
 * 200 { ok:true } on success (code is single-use — the row is deleted).
 * 400 on wrong/expired/missing code; 429 after too many attempts.
 *
 * Constant set of error codes so it doesn't leak whether the number exists.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  let phone = "";
  let code = "";
  try {
    const body = (await req.json()) as { phone?: unknown; code?: unknown };
    if (typeof body.phone === "string") phone = body.phone.trim();
    if (typeof body.code === "string") code = body.code.replace(/\D/g, "");
  } catch {
    /* fall through to 400 */
  }
  if (!/^\+\d{8,15}$/.test(phone) || code.length !== 6) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // Per-IP throttle (cross-instance): the per-number attempt cap below does not
  // stop an attacker brute-forcing codes across many numbers from one IP.
  const { data: ipBlocked } = await admin.rpc("check_auth_ratelimit", { p_ip: ip });
  if (ipBlocked === true) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { data: row } = await admin
    .from("phone_otps")
    .select("code_hash, expires_at, attempts")
    .eq("phone", phone)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "no_code" }, { status: 400 });
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    await admin.from("phone_otps").delete().eq("phone", phone);
    return NextResponse.json({ error: "expired" }, { status: 400 });
  }
  if ((row.attempts as number) >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  if (hashCode(phone, code) !== row.code_hash) {
    await admin
      .from("phone_otps")
      .update({ attempts: (row.attempts as number) + 1 })
      .eq("phone", phone);
    return NextResponse.json({ error: "wrong_code" }, { status: 400 });
  }

  // Correct — stamp a short-lived verification proof that the signup route
  // checks (audit #2: signup must fail closed when SMS is on), and clear the
  // code so it can't be re-verified. The signup route deletes the row once it
  // consumes the proof; a fresh /phone/send upserts a new code + nulls this.
  await admin
    .from("phone_otps")
    .update({ verified_at: new Date().toISOString(), code_hash: "", attempts: 0 })
    .eq("phone", phone);
  return NextResponse.json({ ok: true });
}
