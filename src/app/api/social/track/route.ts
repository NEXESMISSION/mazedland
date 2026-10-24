import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/clientIp";
import { channelFromUtmSource } from "@/lib/social/channels";
import { readTracking } from "@/lib/social/content";

/**
 * POST /api/social/track  { listingId, utm_source, utm_medium, utm_campaign, event }
 *
 * A visit (or a contact) that came from a post — what the console's report
 * counts per request and channel. Sent once per browser session by the
 * annonce page when its address carries the post's UTM tags.
 *
 * No personal data: the visitor is a hash of their address, browser and day,
 * kept only to count one person reloading the page once.
 */
export async function POST(req: NextRequest) {
  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false }, { status: 200 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : null);
  const listingId = str(body.listingId);
  const tracking = readTracking({
    utm_source: str(body.utm_source),
    utm_medium: str(body.utm_medium),
    utm_campaign: str(body.utm_campaign),
  });
  const event = body.event === "contact" ? "contact" : "visit";
  if (!listingId || !/^[0-9a-f-]{36}$/i.test(listingId) || !tracking) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `social-track:${clientIp(req)}`,
    p_max: 60,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ ok: false }, { status: 200 });

  // The request this post belongs to: same reference, same annonce.
  const { data: request } = await admin
    .from("social_publication_requests")
    .select("id")
    .eq("ref", tracking.ref)
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!request) return NextResponse.json({ ok: false }, { status: 200 });

  const day = new Date().toISOString().slice(0, 10);
  const session = createHash("sha256")
    .update(`${clientIp(req)}|${req.headers.get("user-agent") ?? ""}|${day}|${process.env.CRON_SECRET ?? "mazed"}`)
    .digest("hex")
    .slice(0, 32);

  await admin
    .from("social_tracking_events")
    .upsert(
      {
        request_id: request.id,
        listing_id: listingId,
        channel: channelFromUtmSource(tracking.source),
        event,
        session_hash: session,
      },
      { onConflict: "request_id,channel,event,session_hash", ignoreDuplicates: true },
    );
  return NextResponse.json({ ok: true });
}
