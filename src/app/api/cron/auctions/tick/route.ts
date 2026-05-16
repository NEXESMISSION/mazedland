import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Fallback trigger for the auction state machine.
 *
 * The canonical schedule lives in pg_cron (see 0007_state_machine.sql),
 * which fires every minute inside the DB. This HTTP route is a safety
 * net for hosting environments without pg_cron (e.g. self-hosted
 * Supabase that didn't enable the extension) and for ad-hoc nudges.
 *
 * Auth: shared secret in `CRON_SECRET` env, sent either as
 *   - `Authorization: Bearer <secret>` (Vercel Cron convention), or
 *   - `?key=<secret>` query string.
 *
 * Returns the counts of started/closed/awarded auctions so the
 * scheduler's log shows whether anything happened.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_set" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : key;
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await admin.rpc("tick_auctions");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}

// Vercel Cron sometimes posts; accept both verbs.
export const POST = GET;
