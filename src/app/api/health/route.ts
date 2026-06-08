import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Liveness / dead-man's-switch for the in-DB schedulers.
 *
 * process_bid_events (and, via the tick HTTP backstop, the auction tick) stamp
 * public.cron_heartbeat on every run. This endpoint reads those stamps and
 * returns 503 when any monitored job hasn't run within STALE_SECONDS — so an
 * external uptime monitor (Vercel, UptimeRobot, a GitHub Action) pointed here
 * detects a stalled pg_cron (auctions silently not closing / bid notifications
 * frozen) instead of waiting for user complaints.
 *
 * Read-only liveness only — exposes job names + ages, never user data.
 */
const STALE_SECONDS = 300;

export async function GET(): Promise<NextResponse> {
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await admin.from("cron_heartbeat").select("job, last_run");
  if (error) {
    return NextResponse.json({ ok: false, error: "heartbeat_unreadable" }, { status: 503 });
  }

  const now = Date.now();
  const jobs = (data ?? []).map((r) => {
    const ageS = Math.round((now - new Date(r.last_run as string).getTime()) / 1000);
    return { job: r.job as string, last_run: r.last_run as string, age_seconds: ageS };
  });
  const stale = jobs.filter((j) => j.age_seconds > STALE_SECONDS).map((j) => j.job);
  // No heartbeat rows yet (fresh deploy, crons haven't run) is treated as
  // not-yet-healthy rather than a hard failure spamming alerts on day one.
  const ok = jobs.length > 0 && stale.length === 0;

  return NextResponse.json(
    { ok, staleSeconds: STALE_SECONDS, stale, jobs },
    { status: ok ? 200 : 503 },
  );
}
