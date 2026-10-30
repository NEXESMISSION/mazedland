import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/annonces/[id]/report  { reason, note? }
 *
 * Anyone — signed in or not — can report a published annonce. One report per
 * person per annonce (a signed-in user by id, a visitor by a salted hash of
 * their IP). When `moderation_report_threshold` different people have reported
 * it and no admin has dealt with it since, the annonce leaves the catalogue
 * (`pending_review`, flagged `reported`) and the admins are told. The seller is
 * not: a scammer warned is a scammer who re-posts.
 *
 * The threshold and the hourly limit per reporter are set in /admin/settings,
 * where reports can be switched off too: reports already made stay with the
 * admins, new ones are refused.
 */
const REASONS = ["scam", "wrong_info", "sold", "duplicate", "inappropriate", "other"] as const;
type Reason = (typeof REASONS)[number];

function hashIp(ip: string): string {
  // Same salt as the phone-reveal log, so one table cannot be reversed into IPs.
  const salt = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "mazed-immo";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const off = await featureOff("feature_reports");
  if (off) return off;
  const { id } = await ctx.params;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const settings = await getSettings();

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; note?: unknown };
  const reason = REASONS.includes(body.reason as Reason) ? (body.reason as Reason) : null;
  if (!reason) {
    const t = await apiTranslator(req, "listingApi");
    return NextResponse.json({ error: "invalid", detail: t("reportReasonRequired") }, { status: 400 });
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const reporterKey = user ? `u:${user.id}` : `ip:${hashIp(clientIp(req) || "unknown")}`;

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `report:${reporterKey}`,
    p_max: settings.limit_reports_per_hour,
    p_window_secs: 3600,
  });
  if (over === true) {
    const t = await apiTranslator(req, "listingApi");
    return NextResponse.json({ error: "rate_limited", detail: t("tooManyReports") }, { status: 429 });
  }

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, title, status, review_flags")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.status !== "published") {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }
  if (user && user.id === listing.seller_id) {
    const t = await apiTranslator(req, "listingApi");
    return NextResponse.json({ error: "own_listing", detail: t("reportOwnListing") }, { status: 403 });
  }

  // One report per person per wave: a second one from the same reporter
  // changes nothing — unless the first was resolved by a moderator since, in
  // which case this is a new report in a new wave (« a later wave counts from
  // zero »), and the row is reopened rather than dropped.
  const { data: prior } = await admin
    .from("listing_reports")
    .select("id, resolved_at")
    .eq("listing_id", id)
    .eq("reporter_key", reporterKey)
    .maybeSingle();
  const { error: insErr } = prior
    ? prior.resolved_at
      ? await admin
          .from("listing_reports")
          .update({ resolved_at: null, reason, note, reporter_id: user?.id ?? null, created_at: new Date().toISOString() })
          .eq("id", prior.id)
      : { error: null }
    : await admin
        .from("listing_reports")
        .insert({ listing_id: id, reporter_id: user?.id ?? null, reporter_key: reporterKey, reason, note });
  if (insErr) return fail("report_failed", 500, insErr);

  const { count } = await admin
    .from("listing_reports")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", id)
    .is("resolved_at", null);

  let hidden = false;
  const threshold = settings.moderation_report_threshold;
  if ((count ?? 0) >= threshold) {
    const flags = Array.from(new Set([...((listing.review_flags as string[] | null) ?? []), "reported"]));
    const { data: updated } = await admin
      .from("listings")
      .update({ status: "pending_review", review_flags: flags })
      .eq("id", id)
      .eq("status", "published")
      .select("id");
    hidden = (updated?.length ?? 0) > 0;

    if (hidden) {
      await admin
        .rpc("_notify_admins", {
          p_kind: "admin_listing_reported",
          p_title: "Annonce retirée après signalements",
          p_body: `« ${listing.title} » a été signalée par ${count} personnes et n'est plus visible. Vérifiez-la.`,
          p_link: `/admin/annonces?a=${id}`,
          p_payload: { vars: { title: listing.title, count: count ?? threshold } },
        })
        .then(() => {}, () => {});
    }
  }

  logAction(req, user ? { id: user.id, email: user.email } : null, "listing.report", { id, reason, hidden });
  return NextResponse.json({ ok: true });
}
