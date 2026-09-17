import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * POST /api/annonces/[id]/status - what a seller can do to their own annonce
 * once it is live.
 *
 * Until now, nothing. Only an admin could take an annonce down, so a seller
 * whose apartment had just sold either rang up and asked, or left it online
 * and kept answering calls about something that no longer exists. Both make
 * the catalogue less true, which is the one thing it has to be.
 *
 *   { action: "mark_sold" }   published | expired  -> sold
 *   { action: "withdraw" }    published            -> archived
 *   { action: "relist" }      sold | archived      -> published
 *
 * `relist` is what makes the first two safe to offer. Coming down leaves
 * `expires_at` alone, so the days already paid for keep running: putting the
 * annonce back inside that window costs nothing and skips the queue, because
 * it is the same annonce an admin already approved. A seller cannot edit a
 * published, sold or archived annonce - the wizard only reopens `draft`,
 * `rejected` and `pending_payment` - so there is nothing new to check. Once
 * the window has run out, /renew takes over and it is paid for again.
 */

type Action = "mark_sold" | "withdraw" | "relist";

const ALLOWED: Record<Action, string[]> = {
  mark_sold: ["published", "expired"],
  withdraw: ["published"],
  relist: ["sold", "archived"],
};

const REFUSAL: Record<Action, string> = {
  mark_sold: "Seule une annonce en ligne peut être marquée vendue.",
  withdraw: "Cette annonce n'est pas en ligne.",
  relist: "Cette annonce est déjà en ligne ou en cours de traitement.",
};

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
    .select("id, seller_id, status, expires_at, contact_phone")
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  if (listing.seller_id !== user.id) {
    return NextResponse.json({ error: "not_owner" }, { status: 403 });
  }

  const status = listing.status as string;
  if (!ALLOWED[action].includes(status)) {
    return NextResponse.json(
      { error: "wrong_status", detail: REFUSAL[action] },
      { status: 409 },
    );
  }

  // Coming back online: only within the window already paid for.
  if (action === "relist") {
    const until = listing.expires_at ? new Date(listing.expires_at as string).getTime() : 0;
    if (!until || until <= Date.now()) {
      return NextResponse.json(
        {
          error: "window_closed",
          detail: "Votre période de publication est terminée — renouvelez l'annonce.",
        },
        { status: 409 },
      );
    }
    if (!listing.contact_phone) {
      return NextResponse.json(
        { error: "contact_required", detail: "Ajoutez un numéro joignable avant de republier." },
        { status: 400 },
      );
    }

    // `published_at` is left as it was: a relisted annonce keeps its place in
    // the catalogue instead of jumping to the top of the newest rail.
    const { error } = await admin
      .from("listings")
      .update({ status: "published", rejection_reason: null })
      .eq("id", id);
    if (error) return fail("listing_relist_failed", 500, error);

    logAction(req, user, "listing.relist", { id, from: status });
    return NextResponse.json({ ok: true, status: "published", expires_at: listing.expires_at });
  }

  const next = action === "mark_sold" ? "sold" : "archived";
  const { error } = await admin
    .from("listings")
    .update({ status: next })
    .eq("id", id);
  if (error) return fail("listing_status_failed", 500, error);

  logAction(req, user, `listing.${action}`, { id, from: status });
  return NextResponse.json({ ok: true, status: next, expires_at: listing.expires_at });
}
