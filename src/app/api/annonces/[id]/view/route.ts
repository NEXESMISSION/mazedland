import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";

/**
 * POST /api/annonces/[id]/view — record that someone looked at this annonce.
 *
 * WHY AN ENDPOINT AND NOT THE PAGE. The obvious place to count a view is the
 * server component that renders the listing. It would be wrong: Next prefetches
 * linked pages on hover and on viewport entry, so half the "views" would be
 * pages nobody ever saw, and the RSC payload is cached — the same reader would
 * count once or ten times depending on the cache, not on what they did. A
 * deliberate call from the browser after the page is on screen counts the thing
 * we actually mean.
 *
 * The de-duplication is in the database (see 0173): one row per viewer, and a
 * repeat only counts after a 30-minute gap. So this route can be called freely
 * — a refresh will not inflate anything.
 *
 * The IP is hashed with a server secret, exactly as contact reveals are: the
 * table must never become a list of who read what from where.
 */

const MAX_VIEWS_PER_IP_PER_HOUR = 400;

function hashIp(ip: string): string {
  const salt = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "mazed";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Nothing here is worth an error on screen: a missed count is not the reader's problem. */
const ok = () => NextResponse.json({ ok: true });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const admin = getServiceSupabase();
  if (!admin) return ok();

  // A real reader opens a few dozen annonces in an evening. Hundreds an hour
  // from one address is a crawler, and its taste is not worth recording.
  const ipHash = hashIp(clientIp(req) || "unknown");
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `view:${ipHash}`,
    p_max: MAX_VIEWS_PER_IP_PER_HOUR,
    p_window_secs: 3600,
  });
  if (over === true) return ok();

  // Signed in, this is the same person across their phone and their laptop.
  // Signed out, it is one browser on one connection — the best that can be had
  // without following anybody around.
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const viewerKey = user ? `u:${user.id}` : `a:${ipHash}`;

  await admin.rpc("record_listing_view", {
    p_listing: id,
    p_viewer_key: viewerKey,
    p_user: user?.id ?? null,
  });

  return ok();
}
