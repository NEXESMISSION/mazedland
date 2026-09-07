import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

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

type Body = {
  id?: unknown;
  category_id?: unknown;
  title?: unknown;
  description?: unknown;
  price?: unknown;
  negotiable?: unknown;
  price_on_request?: unknown;
  governorate?: unknown;
  delegation?: unknown;
  address?: unknown;
  attributes?: unknown;
  contact_name?: unknown;
  contact_phone?: unknown;
  contact_whatsapp?: unknown;
  show_phone?: unknown;
  attestation_version?: unknown;
  photos?: unknown;    // [{ storage_path, sort_order }]
};

const MAX_PHOTOS = 12;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Tunisian mobile/landline, loosely: +216 XX XXX XXX or 8 local digits. */
function phone(v: unknown): string | null {
  const raw = text(v, 24);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 8) return null;
  return digits.slice(0, 20);
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as Body;

  const categoryId = text(body.category_id, 40);
  const title = text(body.title, 140);
  const governorate = text(body.governorate, 60);

  const id = text(body.id, 40);
  if (!id && (!categoryId || !title || !governorate)) {
    return NextResponse.json(
      { error: "incomplete", detail: "Catégorie, titre et gouvernorat sont requis." },
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
      return NextResponse.json(
        { error: "category_not_leaf", detail: "Choisissez une sous-catégorie." },
        { status: 400 },
      );
    }
  }

  const priceOnRequest = body.price_on_request === true;
  const price = num(body.price);
  if (!priceOnRequest && price == null && !id) {
    return NextResponse.json(
      { error: "price_required", detail: "Indiquez un prix, ou cochez « prix sur demande »." },
      { status: 400 },
    );
  }

  const fields: Record<string, unknown> = {};
  if (categoryId) fields.category_id = categoryId;
  if (title) fields.title = title;
  if ("description" in body) fields.description = text(body.description, 4000);
  if ("price" in body || "price_on_request" in body) {
    fields.price = priceOnRequest ? null : price;
    fields.price_on_request = priceOnRequest;
  }
  if ("negotiable" in body) fields.negotiable = body.negotiable === true;
  if (governorate) fields.governorate = governorate;
  if ("delegation" in body) fields.delegation = text(body.delegation, 60);
  if ("address" in body) fields.address = text(body.address, 200);
  if ("attributes" in body && body.attributes && typeof body.attributes === "object") {
    fields.attributes = body.attributes;
  }
  if ("contact_name" in body) fields.contact_name = text(body.contact_name, 80);
  if ("contact_phone" in body) fields.contact_phone = phone(body.contact_phone);
  if ("contact_whatsapp" in body) fields.contact_whatsapp = phone(body.contact_whatsapp);
  if ("show_phone" in body) fields.show_phone = body.show_phone !== false;
  if ("attestation_version" in body) {
    // Version only — the trigger stamps the moment with the server clock.
    fields.seller_attestation_version = text(body.attestation_version, 20);
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
    // A live listing is edited through its own flow, not by re-running the
    // wizard: silently rewriting a published annonce would skip moderation.
    // On a property site that is the difference between a price correction and
    // a bait-and-switch.
    if (!["draft", "rejected", "pending_payment"].includes(owned.status as string)) {
      return NextResponse.json(
        { error: "not_editable", detail: "Cette annonce est déjà en cours de traitement." },
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
  if (Array.isArray(body.photos)) {
    const rows = body.photos
      .slice(0, MAX_PHOTOS)
      .map((p, i) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const path = text(o.storage_path, 300);
        return path ? { listing_id: listingId, storage_path: path, sort_order: i } : null;
      })
      .filter(Boolean) as { listing_id: string; storage_path: string; sort_order: number }[];

    // Replace wholesale: the client sends the gallery as it should end up, so
    // reordering and removal need no separate endpoints.
    await admin.from("listing_photos").delete().eq("listing_id", listingId);
    if (rows.length > 0) {
      const { error } = await admin.from("listing_photos").insert(rows);
      if (error) return fail("photos_save_failed", 500, error);
    }
  }

  return NextResponse.json({ ok: true, id: listingId });
}
