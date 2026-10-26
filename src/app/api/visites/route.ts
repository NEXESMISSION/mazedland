import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { parseSlots } from "@/lib/visits";
import { leadForVisit, VISIT_COLUMNS, type VisitRow } from "@/lib/visits-server";

/**
 * POST /api/visites — ask to visit an annonce (0174).
 *
 *   { listingId, slots: [{ day, part }] (1–3), name, phone, message? }
 *
 * Signed in only, never on one's own annonce, one open request per annonce.
 * The name and number go to the seller: that is the point, and the form says
 * so. On a shop's annonce the buyer also becomes one of the shop's clients.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const t = await apiTranslator(req, "visitsApi");

  // Ten a day is a buyer who is looking hard; more is someone filling sellers' diaries.
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `visit:${user.id}`, p_max: 10, p_window_secs: 86_400 });
  if (over === true) return NextResponse.json({ error: "rate_limited", detail: t("tooMany") }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const listingId = typeof body.listingId === "string" && /^[0-9a-f-]{36}$/i.test(body.listingId) ? body.listingId : null;
  const slots = parseSlots(body.slots);
  if (!slots) return NextResponse.json({ error: "invalid", detail: t("slots") }, { status: 400 });
  const phone = anyPhoneToE164(body.phone);
  if (!phone) return NextResponse.json({ error: "invalid", detail: t("phone") }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (name.length < 2) return NextResponse.json({ error: "invalid", detail: t("name") }, { status: 400 });
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 600) : null;

  const { data: listing } = listingId
    ? await admin.from("listings").select("id, seller_id, shop_id, status, title").eq("id", listingId).maybeSingle()
    : { data: null };
  if (!listing || listing.status !== "published") return NextResponse.json({ error: "not_found", detail: t("notOnline") }, { status: 404 });
  if (listing.seller_id === user.id) return NextResponse.json({ error: "invalid", detail: t("own") }, { status: 400 });

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
