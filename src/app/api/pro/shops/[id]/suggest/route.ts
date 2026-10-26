import { NextRequest, NextResponse } from "next/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { MAX_SUGGESTIONS_PER_DAY, MAX_SUGGESTIONS_PER_REQUEST } from "@/lib/pro/suggest";
import { matchRequest } from "@/lib/requests/model";
import { toMatchable } from "@/lib/requests/server";
import { asDealType } from "@/lib/listings/deal";

/**
 * POST /api/pro/shops/:id/suggest  { requestId, listingId }
 *
 * A shop puts one of its online annonces in front of the person behind a
 * demande. The shop never learns who that is: the notice goes from here.
 * Only an open demande that asked for alerts, only the same offer (sale or
 * rent), three annonces per demande per shop, thirty a day per shop, and
 * never the same annonce twice.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "clients" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as { requestId?: unknown; listingId?: unknown };
  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  const listingId = typeof body.listingId === "string" && /^[0-9a-f-]{36}$/i.test(body.listingId) ? body.listingId : null;
  if (!requestId || !listingId) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const [{ data: shop }, { data: listing }, { data: demande }] = await Promise.all([
    admin.from("shops").select("name, status").eq("id", id).maybeSingle(),
    admin
      .from("listings")
      .select("id, title, shop_id, status, deal_type, category_id, governorate, price, price_on_request, attributes, furnished, available_from")
      .eq("id", listingId)
      .maybeSingle(),
    admin
      .from("property_requests")
      .select("id, user_id, status, alerts, expires_at, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, move_in_by")
      .eq("id", requestId)
      .maybeSingle(),
  ]);
  if (shop?.status !== "approved") return NextResponse.json({ error: "conflict", detail: t("suggest.shopClosed") }, { status: 409 });
  if (!listing || listing.shop_id !== id || listing.status !== "published") {
    return NextResponse.json({ error: "invalid", detail: t("suggest.listing") }, { status: 400 });
  }
  if (!demande || demande.status !== "active" || !demande.alerts || new Date(demande.expires_at as string).getTime() <= Date.now()) {
    return NextResponse.json({ error: "not_found", detail: t("suggest.closed") }, { status: 404 });
  }
  const request = toMatchable(demande as never);
  if (asDealType(listing.deal_type as string) !== request.deal_type) {
    return NextResponse.json({ error: "invalid", detail: t("suggest.deal") }, { status: 400 });
  }

  // Three per demande from this shop: count its annonces already matched to it.
  const { data: already } = await admin
    .from("matches")
    .select("listing_id, listing:listings!inner (shop_id)")
    .eq("request_id", requestId)
    .eq("listing.shop_id", id);
  if ((already ?? []).length >= MAX_SUGGESTIONS_PER_REQUEST) {
    return NextResponse.json({ error: "conflict", detail: t("suggest.perRequest", { max: MAX_SUGGESTIONS_PER_REQUEST }) }, { status: 409 });
  }
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `suggest:${id}`, p_max: MAX_SUGGESTIONS_PER_DAY, p_window_secs: 86_400 });
  if (over === true) return NextResponse.json({ error: "rate_limited", detail: t("suggest.perDay", { max: MAX_SUGGESTIONS_PER_DAY }) }, { status: 429 });

  const m = matchRequest(listing as never, request);
  const { error } = await admin.from("matches").insert({
    request_id: requestId,
    listing_id: listingId,
    score: m.score,
    reasons: { met: m.met, unknown: m.unknown, suggested_by: id },
  });
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("suggest.already") }, { status: 409 });
  if (error) return fail("suggest_failed", 500, error);

  await admin
    .rpc("enqueue_notification", {
      p_user_id: demande.user_id,
      p_kind: "request_suggestion",
      p_title: "Une agence vous propose un bien",
      p_body: `${shop.name} pense que « ${listing.title} » correspond à votre demande.`,
      p_link: `/annonces/${listingId}`,
      p_payload: { vars: { shop: shop.name, title: listing.title } },
    })
    .then(() => {}, () => {});

  logAction(req, user, "shop.suggest", { shop: id, request: requestId, listing: listingId, score: m.score });
  return NextResponse.json({ ok: true, score: m.score });
}
