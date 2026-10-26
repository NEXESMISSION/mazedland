import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { isSocialChannel, isSocialLanguage } from "@/lib/social/channels";
import { createSocialRequest } from "@/lib/social/server";
import { getSettings } from "@/lib/settings/server";
import { paymentsOpen } from "@/lib/payments";

/**
 * POST /api/social/requests — a seller asks for their annonce to be promoted
 * on Mazed Immo's pages (0170).
 *
 *   { listingId, channels: ["facebook_page" | "instagram" | "facebook_groups"],
 *     language: "both" | "ar" | "fr", consent: true }
 *
 * The consent box must be ticked: it is stored with the request, with the
 * version of the wording, and nothing is posted without it. The annonce must
 * be theirs and online; the texts are generated here, so what an admin
 * approves is what gets posted.
 */
const DETAIL: Record<string, string> = {
  disabled: "disabled",
  not_found: "notFound",
  forbidden: "notFound",
  not_online: "notOnline",
  no_channel: "noChannel",
  consent: "consent",
  already_open: "alreadyOpen",
  no_photo: "noPhoto",
  db: "failed",
};

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `social-request:${user.id}`,
    p_max: 10,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  // A priced promotion is paid like the rest, by transfer or D17. While no
  // payee is set there is nothing to pay it to, so nothing is asked for; at
  // the launch price (0) it goes ahead as before.
  const settings = await getSettings();
  if (settings.social_price_tnd > 0 && !paymentsOpen(settings)) {
    return NextResponse.json({ error: "payments_closed" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const listingId = typeof body.listingId === "string" ? body.listingId : "";
  const channels = Array.isArray(body.channels) ? body.channels.filter(isSocialChannel) : [];
  const language = isSocialLanguage(body.language) ? body.language : "both";

  const result = await createSocialRequest(admin, {
    userId: user.id,
    listingId,
    channels,
    language,
    consent: body.consent === true,
    origin: req.nextUrl.origin,
  });
  if (!result.ok) {
    const t = await apiTranslator(req, "socialApi");
    const status = result.error === "db" ? 500 : result.error === "not_found" || result.error === "forbidden" ? 404 : 400;
    return NextResponse.json({ error: result.error, detail: t(DETAIL[result.error] ?? "failed") }, { status });
  }
  logAction(req, user, "social.request", { id: result.id, listingId, channels });
  return NextResponse.json({ ok: true, id: result.id, status: result.status });
}
