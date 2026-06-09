import { NextRequest, NextResponse } from "next/server";
import { secretMatches } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fallback trigger for the notifications retention sweep — deletes
 * notifications that are both read and older than 90 days.
 *
 * The canonical schedule is a daily pg_cron job at 03:00 UTC. This
 * HTTP route is the fallback for environments without pg_cron.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_set" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : key;
  if (!secretMatches(provided, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await admin.rpc("cleanup_old_notifications");
  if (error) {
    return fail("rpc_failed", 500, error);
  }
  return NextResponse.json({ ok: true, deleted: data });
}

export const POST = GET;
