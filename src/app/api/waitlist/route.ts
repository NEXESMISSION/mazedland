import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";

/**
 * Waitlist signup. Delegates validation and rate-limiting to the
 * `public.enqueue_waitlist` RPC (see 0008_waitlist_ratelimit.sql).
 *
 * The RPC handles:
 *   - email format check
 *   - per-IP rate limit (5 / 5min)
 *   - email idempotency (upsert on conflict)
 *   - locale whitelist
 *
 * Falls back to a "we logged but didn't persist" success when Supabase
 * env isn't configured so the form keeps working during dev.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; phone?: string; locale?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    console.warn("[waitlist] Supabase not configured; skipping persistence", body);
    return NextResponse.json({ ok: true, persisted: false });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null;

  const { data, error } = await supabase.rpc("enqueue_waitlist", {
    p_email: body.email ?? "",
    p_phone: body.phone ?? null,
    p_locale: body.locale ?? "ar",
    p_ip: ip,
  });

  if (error) {
    console.error("[waitlist] rpc failed", error);
    return NextResponse.json({ error: "persist_failed" }, { status: 500 });
  }

  // The RPC returns { ok: boolean, error?: string }. Translate failures
  // to the right HTTP status so the client can show useful feedback.
  const result = data as { ok: boolean; error?: string };
  if (!result?.ok) {
    const code =
      result?.error === "rate_limited" ? 429
      : result?.error === "invalid_email" ? 400
      : 400;
    return NextResponse.json({ error: result?.error ?? "unknown" }, { status: code });
  }

  return NextResponse.json({ ok: true, persisted: true });
}
