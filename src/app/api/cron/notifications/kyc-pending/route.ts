import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

/**
 * "Your KYC is still in queue" reminder driver.
 *
 * Scans profiles with kyc_status in ('submitted','pending') whose
 * kyc_submitted_at is older than 24h and hasn't been reminded yet, and
 * pings them a single 'kyc_pending_reminder' notification. The SQL
 * function (notify_kyc_pending_reminder, migration 0051) handles the
 * dedup via a kyc_pending_reminded_at column, so a re-run never
 * double-sends.
 *
 * Auth: shared CRON_SECRET, same shape as the other cron endpoints
 * (Bearer header or ?key= query param).
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

  const { data, error } = await admin.rpc("notify_kyc_pending_reminder");
  if (error) {
    return fail("rpc_failed", 500, error);
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}

export const POST = GET;
