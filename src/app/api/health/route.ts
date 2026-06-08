import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { secretMatches } from "@/lib/cron/auth";
import { evaluateHeartbeats, type HeartbeatRow } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

/**
 * Liveness / dead-man's-switch for the schedulers.
 *
 * Every monitored cron stamps public.cron_heartbeat on each run; this endpoint
 * returns 503 when any job is stale beyond its own max_age_seconds budget — so
 * an external monitor pointed here detects a stalled scheduler (auctions not
 * closing, money emails not sending) instead of waiting for user complaints.
 * The staleness math lives in src/lib/observability/health.ts (unit-tested).
 *
 * The 200/503 status is public (an anonymous monitor needs it). The detailed
 * scheduler TOPOLOGY (job names, cadences, ages) is returned only to a caller
 * holding the CRON_SECRET, so the internal schedule isn't enumerable by anyone.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await admin
    .from("cron_heartbeat")
    .select("job, last_run, max_age_seconds");
  if (error) {
    return NextResponse.json({ ok: false, error: "heartbeat_unreadable" }, { status: 503 });
  }

  const status = evaluateHeartbeats((data ?? []) as HeartbeatRow[], Date.now());

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : key;
  const authorized = !!secret && secretMatches(provided, secret);

  const body = authorized
    ? { ok: status.ok, stale: status.stale, jobs: status.jobs }
    : { ok: status.ok, stale_count: status.stale.length };

  return NextResponse.json(body, { status: status.ok ? 200 : 503 });
}
