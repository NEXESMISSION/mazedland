import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { fail } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

/**
 * "You haven't scheduled your auction yet" reminder driver.
 *
 * Listings approved 3+ days ago that still don't have a matching
 * auctions row get a single 'listing_unscheduled_reminder' ping
 * pointing at /sell/<id>/schedule. Direct-sale listings auto-publish
 * an auctions row on approval (see migration 0028), so this scan
 * filters them out via listing_type='auction'.
 *
 * Idempotent — the SQL function (notify_unscheduled_listings,
 * migration 0051) sets unscheduled_reminded_at after enqueueing,
 * and an auctions INSERT trigger resets the flag if the seller
 * later schedules + un-schedules.
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

  const { data, error } = await admin.rpc("notify_unscheduled_listings");
  if (error) {
    return fail("rpc_failed", 500, error);
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}

export const POST = GET;
