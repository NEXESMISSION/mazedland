import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { listingFields, listingPhotos, num, text, type ListingBody } from "@/lib/listings/input";
import { can, roleIn } from "@/lib/pro/shops";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/annonces — create or update the seller's draft listing.
 *
 * Ported from Mazed Auto, minus two things that do not describe a building:
 * `condition` (neuf / occasion) and `listing_fitments` (a part fits a car; a
 * villa fits nothing). Everything a property needs beyond the shared columns —
 * surface, pieces, constructible, titre foncier — is validated against
 * `category_attributes` and stored in `attributes`.
 *
 * The wizard saves through this on every step, so a dropped connection at the
 * photo stage doesn't lose the details typed two screens earlier. Pass `id` to
 * update the draft that was already created.
 *
 * The server owns three things the client cannot be trusted with:
 *   • seller_id — always the caller, never the body
 *   • status    — a draft is a draft; publication goes through /submit and
 *                 moderation (0146's guard refuses anything else anyway)
 *   • the attestation timestamp — server clock, on the version string only
 */

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as ListingBody;

  const categoryId = text(body.category_id, 40);
  const title = text(body.title, 140);
  const governorate = text(body.governorate, 60);

  const id = text(body.id, 40);
  if (!id && (!categoryId || !title || !governorate)) {
    const t = await apiTranslator(req, "publishApi");
    return NextResponse.json(
      { error: "incomplete", detail: t("incomplete") },
      { status: 400 },
    );
  }

  // The category must exist and be a leaf — a listing filed under
  // « Résidentiel » instead of « Villas » is invisible to every filter.
  if (categoryId) {
    const { data: cat } = await admin
      .from("categories")
      .select("id, parent_id, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (!cat || !cat.is_active) {
      return NextResponse.json({ error: "bad_category" }, { status: 400 });
    }
    if (cat.parent_id == null) {
      const t = await apiTranslator(req, "publishApi");
      return NextResponse.json(
        { error: "category_not_leaf", detail: t("categoryNotLeaf") },
        { status: 400 },
      );
    }
  }

  const priceOnRequest = body.price_on_request === true;
  const price = num(body.price);
  if (!priceOnRequest && price == null && !id) {
    const t = await apiTranslator(req, "publishApi");
    return NextResponse.json(
      { error: "price_required", detail: t("priceRequired") },
      { status: 400 },
    );
  }

  const fields = listingFields(body);

  // Published for a shop (0173): only one the seller may publish for.
  if ("shop_id" in body) {
    let shopId = text((body as Record<string, unknown>).shop_id, 40);
    // An agence's owner IS the agence (the owner's call, 2026-10-28): « for
    // myself » from them — a page opened before that rule — is their agence.
    if (!shopId) {
      const { data: owned } = await admin
        .from("shops")
        .select("id")
        .eq("owner_id", user.id)
        .eq("status", "approved")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      shopId = (owned?.id as string | undefined) ?? null;
    }
    if (shopId) {
      const [role, { data: shop }] = await Promise.all([
        roleIn(admin, shopId, user.id),
        admin.from("shops").select("status").eq("id", shopId).maybeSingle(),
      ]);
      // A shop that is not open has no page to show the annonce on.
      if (!can(role, "publish") || shop?.status !== "approved") return NextResponse.json({ error: "not_owner" }, { status: 403 });
    }
    fields.shop_id = shopId;
  }

  let listingId = id;

  if (listingId) {
    const { data: owned } = await admin
      .from("listings")
      .select("id, seller_id, status")
      .eq("id", listingId)
      .maybeSingle();
    if (!owned || owned.seller_id !== user.id) {
      return NextResponse.json({ error: "not_owner" }, { status: 403 });
    }
    // A live listing is edited through its own flow (POST /api/annonces/:id/edit,
    // 0172), checked by the moderation rules before it replaces what is online:
    // on a property site that is the difference between a price correction and
    // a bait-and-switch.
    if (!["draft", "rejected", "pending_payment"].includes(owned.status as string)) {
      const t = await apiTranslator(req, "publishApi");
      return NextResponse.json(
        { error: "not_editable", detail: t("notEditable") },
        { status: 409 },
      );
    }
    if (Object.keys(fields).length > 0) {
      const { error } = await admin.from("listings").update(fields).eq("id", listingId);
      if (error) return fail("listing_update_failed", 500, error);
    }
  } else {
    const { data: created, error } = await admin
      .from("listings")
      .insert({ ...fields, seller_id: user.id, status: "draft" })
      .select("id")
      .single();
    if (error || !created) return fail("listing_create_failed", 500, error);
    listingId = created.id as string;
    logAction(req, user, "listing.create", { id: listingId });
  }

  // ── Photos: the wizard uploads to storage first, then sends the paths ─────
  // At most what an admin allows per annonce.
  const photos = listingPhotos(body, (await getSettings()).listing_max_photos);
  if (photos) {
    // Replace wholesale: the client sends the gallery as it should end up, so
    // reordering and removal need no separate endpoints.
    await admin.from("listing_photos").delete().eq("listing_id", listingId);
    if (photos.length > 0) {
      const { error } = await admin.from("listing_photos").insert(photos.map((p) => ({ ...p, listing_id: listingId })));
      if (error) return fail("photos_save_failed", 500, error);
    }
  }

  return NextResponse.json({ ok: true, id: listingId });
}
