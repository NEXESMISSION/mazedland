import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { listingFields, listingPhotos, type ListingBody } from "@/lib/listings/input";
import { dropEdit, editWaiting, isEditable, proposeEdit } from "@/lib/listings/edit";

/**
 * POST /api/annonces/:id/edit — the seller's new version of an annonce that is
 * online (0172). Same body as the draft route; the whole form is sent at the
 * end, nothing is written while the seller types.
 *
 *   → { status: "pending", flags }     every edit: an admin approves it first,
 *                                      and the annonce is offline until then
 *                                      (0176). Sent again while it waits, the
 *                                      newer version replaces the waiting one.
 *
 * An annonce still waiting for its first approval can be corrected too — a zero too
 * many on the price is noticed right after sending. It is not online, so the
 * new version replaces it and the moderation runs again:
 *   → { status: "published" }          clean now: online
 *   → { status: "pending_review" }     still waiting, reasons updated
 * Not one taken offline after reports: an admin judges it as it was reported.
 *
 * DELETE /api/annonces/:id/edit — withdraw an edit still waiting for an admin:
 * the approved version goes back online as it was.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const t = await apiTranslator(req, "publishApi");

  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `listing-edit:${user.id}`,
    p_max: 20,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, review_flags, pending_edit_at")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.seller_id !== user.id) return NextResponse.json({ error: "not_owner" }, { status: 403 });
  if (!isEditable(listing)) {
    const held = listing.status === "pending_review";
    return NextResponse.json({ error: "not_editable", detail: t(held ? "editHeldReported" : "editOnlyLive") }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as ListingBody;
  const fields = listingFields(body);
  const photos = listingPhotos(body);

  // What a live annonce cannot lose: a title, a place, a price (or « sur
  // demande »), a way to call, a photo.
  if (("title" in body && !fields.title) || ("governorate" in body && !fields.governorate)) {
    return NextResponse.json({ error: "incomplete", detail: t("incomplete") }, { status: 400 });
  }
  if ("price" in fields && fields.price == null && fields.price_on_request !== true) {
    return NextResponse.json({ error: "price_required", detail: t("priceRequired") }, { status: 400 });
  }
  if ("contact_phone" in body && !fields.contact_phone) {
    return NextResponse.json({ error: "contact_required", detail: t("contactRequired") }, { status: 400 });
  }
  if (photos && photos.length === 0) {
    return NextResponse.json({ error: "photo_required", detail: t("photoRequired") }, { status: 400 });
  }
  if (typeof fields.category_id === "string") {
    const { data: cat } = await admin.from("categories").select("parent_id, is_active").eq("id", fields.category_id).maybeSingle();
    if (!cat || !cat.is_active || cat.parent_id == null) {
      return NextResponse.json({ error: "category_not_leaf", detail: t("categoryNotLeaf") }, { status: 400 });
    }
  }
  // The attestation was given when it went online; an edit does not re-sign it.
  delete fields.seller_attestation_version;

  if (listing.status === "pending_review" && !listing.pending_edit_at) {
    const waiting = await editWaiting(admin, id, { fields, photos });
    if (waiting.status === "error") return fail("listing_edit_failed", 500, waiting.error);
    logAction(req, user, "listing.edit_waiting", { id, status: waiting.status });
    return NextResponse.json({ ok: true, status: waiting.status });
  }

  const result = await proposeEdit(admin, id, { fields, photos });
  if (result.status === "error") return fail("listing_edit_failed", 500, result.error);
  logAction(req, user, "listing.edit", { id, status: result.status });
  return NextResponse.json({ ok: true, status: "pending", flags: result.flags });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const out = await dropEdit(admin, id, { sellerId: user.id });
  if (!out.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logAction(req, user, "listing.edit_withdrawn", { id, status: out.status });
  return NextResponse.json({ ok: true, status: out.status });
}
