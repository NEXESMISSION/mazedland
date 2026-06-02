import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { sendSms, isSmsConfigured } from "@/lib/winsms";
import { hashCode } from "@/lib/otp";
import { log } from "@/lib/log";

const oLog = log.scope("otp-send");

const COOLDOWN_MS = 60_000; // min gap between sends to one number
const WINDOW_MS = 60 * 60 * 1000; // rolling 1h window
const MAX_PER_WINDOW = 5; // sends per number per window
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * POST /api/auth/phone/send — issue a 6-digit SMS verification code via WinSMS.
 *
 * Env-gated: if WinSMS isn't configured, returns { ok:true, configured:false }
 * so the signup flow can skip verification and keep working until the key lands.
 *
 * Codes are stored hashed in phone_otps (serverless-safe). Rate-limited per
 * number: 60s cooldown + max 5 / hour. Responses don't reveal whether a number
 * is already registered.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // SMS off → tell the client to proceed without verification.
  if (!isSmsConfigured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  let phone = "";
  try {
    const body = (await req.json()) as { phone?: unknown };
    if (typeof body.phone === "string") phone = body.phone.trim();
  } catch {
    /* phone stays empty → 400 below */
  }
  if (!/^\+\d{8,15}$/.test(phone)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const now = Date.now();
  const { data: existing } = await admin
    .from("phone_otps")
    .select("send_count, window_start, last_sent_at")
    .eq("phone", phone)
    .maybeSingle();

  let sendCount = 1;
  let windowStart = new Date(now).toISOString();
  if (existing) {
    const last = new Date(existing.last_sent_at as string).getTime();
    if (now - last < COOLDOWN_MS) {
      return NextResponse.json(
        { error: "cooldown", retryAfter: Math.ceil((COOLDOWN_MS - (now - last)) / 1000) },
        { status: 429 },
      );
    }
    const wStart = new Date(existing.window_start as string).getTime();
    if (now - wStart < WINDOW_MS) {
      if ((existing.send_count as number) >= MAX_PER_WINDOW) {
        return NextResponse.json({ error: "too_many" }, { status: 429 });
      }
      sendCount = (existing.send_count as number) + 1;
      windowStart = new Date(wStart).toISOString();
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const nowIso = new Date(now).toISOString();

  const { error: upErr } = await admin.from("phone_otps").upsert(
    {
      phone,
      code_hash: hashCode(phone, code),
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
      send_count: sendCount,
      window_start: windowStart,
      last_sent_at: nowIso,
    },
    { onConflict: "phone" },
  );
  if (upErr) {
    oLog.error(`store failed: ${upErr.message}`);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  const message = `Votre code de vérification Batta.tn est : ${code}. Valable 10 minutes.`;
  const sent = await sendSms({ to: phone, sms: message });
  if (!sent.ok) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, configured: true });
}
