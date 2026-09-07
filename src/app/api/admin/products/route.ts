import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { PRODUCT_KINDS, PRODUCT_SELECT, type ProductKind } from "@/lib/products";

/**
 * The price list, editable.
 *
 *   GET    → every product, active or not
 *   POST   → create one
 *   PATCH  → update one (id in the body)
 *   DELETE → deactivate one (?id=…). Never a hard delete: a product is
 *            referenced by the payments and credits already sold under it, and
 *            deleting the row would orphan a seller's forfait.
 *
 * Admin-only. Prices are money, so every field is re-validated here rather than
 * trusted from the form.
 */

type Body = {
  id?: unknown;
  slug?: unknown;
  kind?: unknown;
  name_fr?: unknown;
  name_ar?: unknown;
  description?: unknown;
  price?: unknown;
  category_id?: unknown;
  listing_quota?: unknown;
  duration_days?: unknown;
  is_active?: unknown;
  sort_order?: unknown;
};

const MAX_PRICE = 100_000;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Money in, sane number out. Rejects nothing — clamps, like the settings route. */
function money(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_PRICE, Math.round(n * 100) / 100);
}

function posInt(v: unknown, max: number): number | null {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(max, n);
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data, error } = await admin
    .from("products")
    .select(PRODUCT_SELECT)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return fail("products_read_failed", 500, error);

  return NextResponse.json({ products: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as Body;
  const kind = PRODUCT_KINDS.includes(body.kind as ProductKind)
    ? (body.kind as ProductKind)
    : null;
  const nameFr = text(body.name_fr, 120);
  if (!kind || !nameFr) {
    return NextResponse.json({ error: "kind_and_name_required" }, { status: 400 });
  }

  const quota = posInt(body.listing_quota, 1000);
  const duration = posInt(body.duration_days, 3650);

  // The DB enforces these too (0157); catching them here turns a redacted 500
  // into a sentence the admin can act on.
  if ((kind === "listing_pack" || kind === "subscription") && !quota) {
    return NextResponse.json(
      { error: "quota_required", detail: "Un pack doit accorder au moins une publication." },
      { status: 400 },
    );
  }
  if (kind === "badge_verified" && !duration) {
    return NextResponse.json(
      { error: "duration_required", detail: "Le badge doit avoir une durée de validité." },
      { status: 400 },
    );
  }

  const slug = text(body.slug, 60) ? slugify(text(body.slug, 60) as string) : slugify(nameFr);
  if (!slug) return NextResponse.json({ error: "bad_slug" }, { status: 400 });

  const { data, error } = await admin
    .from("products")
    .insert({
      slug,
      kind,
      name_fr: nameFr,
      name_ar: text(body.name_ar, 120),
      description: text(body.description, 500),
      price: money(body.price),
      category_id: text(body.category_id, 40),
      listing_quota: quota,
      duration_days: duration,
      is_active: body.is_active === true,
      sort_order: posInt(body.sort_order, 9999) ?? 100,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "slug_taken", detail: "Un produit porte déjà ce nom." },
        { status: 409 },
      );
    }
    return fail("product_create_failed", 500, error);
  }

  logAction(req, user, "admin.product.create", { id: data.id, kind, slug });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as Body;
  const id = text(body.id, 40);
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  // Only the fields actually sent are touched, so a form that renders one row
  // can't blank the rest.
  const patch: Record<string, unknown> = {};
  if ("name_fr" in body) patch.name_fr = text(body.name_fr, 120);
  if ("name_ar" in body) patch.name_ar = text(body.name_ar, 120);
  if ("description" in body) patch.description = text(body.description, 500);
  if ("price" in body) patch.price = money(body.price);
  if ("category_id" in body) patch.category_id = text(body.category_id, 40);
  if ("listing_quota" in body) patch.listing_quota = posInt(body.listing_quota, 1000);
  if ("duration_days" in body) patch.duration_days = posInt(body.duration_days, 3650);
  if ("is_active" in body) patch.is_active = body.is_active === true;
  if ("sort_order" in body) patch.sort_order = posInt(body.sort_order, 9999) ?? 100;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const { error } = await admin.from("products").update(patch).eq("id", id);
  if (error) {
    // 23514 = a CHECK from 0157 (pack without quota, badge without duration,
    // two active single prices for one category).
    if (error.code === "23514" || error.code === "23505") {
      return NextResponse.json(
        {
          error: "invalid_product",
          detail:
            "Vérifiez la cohérence : un pack a besoin d'un quota, un badge d'une durée, " +
            "et une seule annonce à l'unité peut être active par catégorie.",
        },
        { status: 400 },
      );
    }
    return fail("product_update_failed", 500, error);
  }

  logAction(req, user, "admin.product.update", { id, fields: Object.keys(patch) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  // Deactivate, never delete: sellers hold credits bought under this row, and
  // the payments that funded them point at it.
  const { error } = await admin.from("products").update({ is_active: false }).eq("id", id);
  if (error) return fail("product_deactivate_failed", 500, error);

  logAction(req, user, "admin.product.deactivate", { id });
  return NextResponse.json({ ok: true, deactivated: true });
}
