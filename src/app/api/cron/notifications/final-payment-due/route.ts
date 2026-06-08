import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

/**
 * Fallback trigger for final-payment-due reminders (T-7d, T-1d, overdue).
 *
 * The canonical schedule is a pg_cron job that fires hourly. This HTTP
 * route lets external schedulers drive the same RPC for environments
 * without pg_cron.
 *
 * Auth: shared secret in `CRON_SECRET` env, sent as either
 *   - `Authorization: Bearer <secret>`, or
 *   - `?key=<secret>`.
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

  const { data, error } = await admin.rpc("notify_final_payment_due");
  if (error) {
    return fail("rpc_failed", 500, error);
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}

export const POST = GET;
