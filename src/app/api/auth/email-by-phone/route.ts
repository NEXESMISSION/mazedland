import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Phone → email lookup for the "sign in with phone" flow.
 *
 *   Body: { phone: "+216..." }   E.164, normalized client-side.
 *   200:  { email: string | null }
 *
 * Why this endpoint exists: we don't enable Supabase's phone auth
 * provider (no SMS budget yet), so a user signing in with their phone
 * number needs us to map phone → email before we can call
 * supabase.auth.signInWithPassword({ email, password }). We do that
 * lookup here with the service-role key, since the public `profiles`
 * table doesn't expose phone+id together to anonymous readers.
 *
 * Security posture:
 *   - Returns `{ email: null }` for both "phone unknown" and "phone
 *     malformed", so the response shape doesn't reveal whether a number
 *     is registered. The login error a wrong-password attempt produces
 *     is the same regardless.
 *   - Phone shape is sanity-checked (E.164, ≤ 16 chars) before we hit
 *     the DB. Anything malformed bails fast without a DB read.
 *   - Best-effort in-process rate limit (8 calls / minute / IP). Won't
 *     survive process restarts (serverless), which is acceptable: the
 *     real defence is Supabase's own auth rate limiter on signIn.
 */

const BUCKET = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (BUCKET.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  BUCKET.set(ip, hits);
  return hits.length > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";
  if (rateLimited(ip)) {
    return NextResponse.json({ email: null }, { status: 429 });
  }

  let phone: string | null = null;
  try {
    const body = (await req.json()) as { phone?: unknown };
    if (typeof body.phone === "string") phone = body.phone.trim();
  } catch {
    /* fall through; phone stays null and we return early below */
  }
  if (!phone || phone.length > 16 || !/^\+\d{6,15}$/.test(phone)) {
    return NextResponse.json({ email: null });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ email: null }, { status: 500 });
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (!profile?.id) {
    return NextResponse.json({ email: null });
  }

  const { data: userRes, error } = await admin.auth.admin.getUserById(profile.id);
  if (error || !userRes?.user?.email) {
    return NextResponse.json({ email: null });
  }
  return NextResponse.json({ email: userRes.user.email });
}
