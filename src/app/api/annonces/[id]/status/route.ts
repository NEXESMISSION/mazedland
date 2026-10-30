import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { asDealType, closedStatus } from "@/lib/listings/deal";
import { moderationSettings } from "@/lib/moderation/server";
import { takePlace } from "@/lib/places/server";
import { placeRefusal } from "@/lib/places/refusal";
import { suspendedResponse } from "@/lib/moderation/ban";

/**
 * POST /api/annonces/[id]/status - what a seller can do to their own annonce
 * once it is live.
 *
 * Until now, nothing. Only an admin could take an annonce down, so a seller
 * whose apartment had just sold either rang up and asked, or left it online
 * and kept answering calls about something that no longer exists. Both make
 * the catalogue less true, which is the one thing it has to be.
 *
 *   { action: "mark_sold" }   published | expired  -> sold (rented, for a rental)
 *   { action: "withdraw" }    published            -> archived
 *   { action: "relist" }      sold | rented | archived -> published
 *   { action: "reserve" }     published, available -> availability reserved
 *   { action: "unreserve" }   published, reserved  -> availability available
 *
 * « Réservé » keeps the annonce in the catalogue with a badge: a flat promised
 * to someone who has not signed yet is still worth a call from the next
 * person, and taking it down would lose them if the first one walks away.
 *
 * `relist` is what makes the first two safe to offer. Coming down leaves
 * `expires_at` alone, so the days already paid for keep running: putting the
 * annonce back inside that window costs nothing and skips the queue, because
 * it is the same annonce an admin already approved. A seller cannot edit a
 * published, sold or archived annonce - the wizard only reopens `draft`,
 * `rejected` and `pending_payment` - so there is nothing new to check. Once
 * the window has run out, /renew takes over and it is paid for again.
 */

type Action = "mark_sold" | "withdraw" | "relist" | "reserve" | "unreserve";

const ALLOWED: Record<Action, string[]> = {
  mark_sold: ["published", "expired"],
  withdraw: ["published"],
  relist: ["sold", "rented", "archived"],
  reserve: ["published"],
  unreserve: ["published"],
};

// Why each action is refused from the wrong status: the sentence is
// `accountApi.status.refusal.<action>`, in the seller's language.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action as Action | undefined;
  if (!action || !(action in ALLOWED)) {
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, expires_at, contact_phone, deal_type, availability, shop_id")
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  if (listing.seller_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }

  const status = listing.status as string;
  if (!ALLOWED[action].includes(status)) {
    const t = await apiTranslator(req, "accountApi.status");
    return NextResponse.json(
      { error: "wrong_status", detail: t(`refusal.${action}`) },
      { status: 409 },
    );
  }

  // Coming back online: only within the window already paid for.
  if (action === "relist") {
    const until = listing.expires_at ? new Date(listing.expires_at as string).getTime() : 0;
    if (!until || until <= Date.now()) {
      const t = await apiTranslator(req, "accountApi.status");
      return NextResponse.json(
        { error: "window_closed", detail: t("windowClosed") },
        { status: 409 },
      );
    }
    if (!listing.contact_phone) {
      const t = await apiTranslator(req, "accountApi.status");
      return NextResponse.json(
        { error: "contact_required", detail: t("contactRequired") },
        { status: 400 },
      );
    }

    // A suspended seller puts nothing back online (src/lib/moderation/ban.ts).
    const banned = await suspendedResponse(admin, req, user.id);
    if (banned) return banned;

    // Back online takes a place, like any publication. Withdrawing annonces
    // to free places, publishing new ones, then relisting the withdrawn ones
    // got round the free limit: two free annonces became as many as one
    // liked. The agence's plan, a free place, or a credit (src/lib/places) —
    // else refused. The place is counted and the status flipped to
    // « published » in one transaction (0190), and an annonce an admin took
    // down (`taken_down_at`) is refused there: « Remettre en ligne » used to
    // undo the admin's decision with no moderation at all.
    const settings = await moderationSettings(admin);
    const taken = await takePlace(
      admin,
      { userId: user.id, listingId: id, shopId: (listing.shop_id as string | null) ?? null, fromStatus: status },
      settings.freeLimit,
      { from: ALLOWED.relist, to: "published" },
    );
    if (!taken.ok) {
      if (taken.reason !== "free_limit_reached") return placeRefusal(req, taken.reason);
      const t = await apiTranslator(req, "publishApi");
      logAction(req, user, "listing.relist.free_limit", { id, limit: settings.freeLimit });
      return NextResponse.json(
        { error: "free_limit_reached", freeLimit: settings.freeLimit, detail: t("freeLimitReached", { limit: settings.freeLimit }) },
        { status: 402 },
      );
    }

    // `published_at` is left as it was: a relisted annonce keeps its place in
    // the catalogue instead of jumping to the top of the newest rail.
    const { error } = await admin
      .from("listings")
      .update({ rejection_reason: null, availability: "available" })
      .eq("id", id);
    if (error) return fail("listing_relist_failed", 500, error);

    logAction(req, user, "listing.relist", { id, from: status });
    return NextResponse.json({ ok: true, status: "published", expires_at: listing.expires_at });
  }

  if (action === "reserve" || action === "unreserve") {
    const availability = action === "reserve" ? "reserved" : "available";
    const { error } = await admin.from("listings").update({ availability }).eq("id", id);
    if (error) return fail("listing_status_failed", 500, error);
    logAction(req, user, `listing.${action}`, { id });
    return NextResponse.json({ ok: true, status, availability, expires_at: listing.expires_at });
  }

  const next = action === "mark_sold" ? closedStatus(asDealType(listing.deal_type)) : "archived";
  const { error } = await admin
    .from("listings")
    .update({ status: next })
    .eq("id", id);
  if (error) return fail("listing_status_failed", 500, error);

  logAction(req, user, `listing.${action}`, { id, from: status });
  return NextResponse.json({ ok: true, status: next, expires_at: listing.expires_at });
}
