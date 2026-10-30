import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { parseSlots, personName, tunisDay } from "@/lib/visits";
import { leadForVisit, VISIT_COLUMNS, type VisitRow } from "@/lib/visits-server";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/visites — ask to visit an annonce (0174).
 *
 *   { listingId, slots: [{ day, part }] (1–visits_max_slots), name, phone, message? }
 *
 * Signed in only, never on one's own annonce, one open request per annonce.
 * The name and number go to the seller: that is the point, and the form says
 * so. On a shop's annonce the buyer also becomes one of the shop's clients.
 * Switched off, no new request; those already made are still answered
 * (PATCH /api/visites/:id).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const off = await featureOff("feature_visits");
  if (off) return off;
  const settings = await getSettings();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "visitsApi");

  const body = await jsonObject(req);
  const listingId = typeof body.listingId === "string" && /^[0-9a-f-]{36}$/i.test(body.listingId) ? body.listingId : null;
  const rules = { maxSlots: settings.visits_max_slots, horizonDays: settings.visits_horizon_days };
  const slots = parseSlots(body.slots, tunisDay(), rules);
  if (!slots) return NextResponse.json({ error: "invalid", detail: t("slots", { max: rules.maxSlots, days: rules.horizonDays }) }, { status: 400 });
  const phone = anyPhoneToE164(body.phone);
  if (!phone) return NextResponse.json({ error: "invalid", detail: t("phone") }, { status: 400 });
  // A name, not a message: it reaches the seller under the platform's name.
  const name = personName(body.name);
  if (!name) {
    const typed = typeof body.name === "string" && body.name.trim().length >= 2;
    return NextResponse.json({ error: "invalid", detail: t(typed ? "nameLetters" : "name") }, { status: 400 });
  }
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 600) : null;

  const { data: listing } = listingId
    ? await admin.from("listings").select("id, seller_id, shop_id, status, title").eq("id", listingId).maybeSingle()
    : { data: null };
  if (!listing || listing.status !== "published") return NextResponse.json({ error: "not_found", detail: t("notOnline") }, { status: 404 });
  if (listing.seller_id === user.id) return NextResponse.json({ error: "invalid", detail: t("own") }, { status: 400 });

  // Ten a day (the default) is a buyer who is looking hard; more is someone
  // filling sellers' diaries. Counted here, after the checks: a mistyped form
  // or a client retrying a 400 used to spend the day's requests.
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `visit:${user.id}`, p_max: settings.limit_visits_per_day, p_window_secs: 86_400 });
  if (over === true) return NextResponse.json({ error: "rate_limited", detail: t("tooMany") }, { status: 429 });

  const { data: created, error } = await admin
    .from("visit_requests")
    .insert({
      listing_id: listing.id,
      buyer_id: user.id,
      seller_id: listing.seller_id,
      shop_id: listing.shop_id ?? null,
      slots,
      buyer_name: name,
      buyer_phone: phone,
      message,
    })
    .select(VISIT_COLUMNS)
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("alreadyOpen") }, { status: 409 });
  if (error || !created) return fail("visit_create_failed", 500, error);
  const visit = created as unknown as VisitRow;

  await leadForVisit(admin, visit).catch(() => {});
  await admin
    .rpc("enqueue_notification", {
      p_user_id: listing.seller_id,
      p_kind: "visit_requested",
      p_title: "Demande de visite",
      p_body: `${name} souhaite visiter « ${listing.title} ».`,
      p_link: `/account/visites?v=${visit.id}`,
      p_payload: { vars: { title: listing.title, name, count: slots.length } },
    })
    .then(() => {}, () => {});

  logAction(req, user, "visit.request", { id: visit.id, listing: listing.id });
  return NextResponse.json({ ok: true, id: visit.id });
}
