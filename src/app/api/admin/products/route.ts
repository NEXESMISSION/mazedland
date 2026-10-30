import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { isUuid } from "@/lib/uuid";
import { apiTranslator } from "@/lib/i18n/server";
import { PRODUCT_KINDS, PRODUCT_SELECT, unsellable, type ProductKind } from "@/lib/products";

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
 * trusted from the form — and refused, not clamped: « abc », « 59,5 » and −5
 * all became 0 TND, and an active plan at 0 TND sends every buyer to a 500
 * (a payment is never for nothing, payments_amount_check). A kind that is
 * bought cannot go on sale at 0 (src/lib/products.ts, unsellable).
 *
 * `name_ar` / `description_ar` (0163) are optional, with the French fields'
 * limits; an empty string stores null and the Arabic site falls back to French.
 */

type Body = {
  id?: unknown;
  slug?: unknown;
  kind?: unknown;
  name_fr?: unknown;
  name_ar?: unknown;
  description?: unknown;
  description_ar?: unknown;
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

/**
 * Money in: a finite number ≥ 0 (a numeric string counts), to the centime,
 * capped. `null` when no price was given — the form sends null for a cleared
 * field — and "invalid" for anything that is not a price.
 */
function money(v: unknown): number | null | "invalid" {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.min(MAX_PRICE, Math.round(n * 100) / 100);
}

function posInt(v: unknown, max: number): number | null {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(max, n);
}

/** A category id: a uuid, or none (null / empty: the price applies to every category). */
function category(v: unknown): string | null | "invalid" {
  if (v == null || v === "") return null;
  return isUuid(v) ? v : "invalid";
}

/** A refusal the admin can act on; `error` stays a stable code. */
const refuse = (error: string, detail: string, status = 400) => NextResponse.json({ error, detail }, { status });

/**
 * A Postgres refusal the admin can act on, or null for a real failure.
 *   23514 — a CHECK from 0157 (pack without quota, badge without duration,
 *           two active single prices for one category)
 *   23505 — the slug is taken
 *   23503 — the category does not exist
 *   22P02 / 23502 — a value the column cannot hold (a junk id, a blank name)
 */
function refusedBy(error: { code?: string; message?: string; details?: string }, t: (key: string) => string): NextResponse | null {
  switch (error.code) {
    case "23514":
    case "22P02":
    case "23502":
      return refuse("invalid_product", t("invalidProduct"));
    case "23505":
      // Two unique rules: the slug, and one active single price per category (0148).
      return /slug/i.test(`${error.message ?? ""} ${error.details ?? ""}`)
        ? refuse("slug_taken", t("slugTaken"), 409)
        : refuse("invalid_product", t("invalidProduct"));
    case "23503":
      return refuse("invalid_category", t("categoryUnknown"));
    default:
      return null;
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, "offres");
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
  const gate = await requireAdmin(req, "offres");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await jsonObject(req)) as Body;
  const t = await apiTranslator(req, "adminOffers.api");
  const kind = PRODUCT_KINDS.includes(body.kind as ProductKind)
    ? (body.kind as ProductKind)
    : null;
  const nameFr = text(body.name_fr, 120);
  if (!kind || !nameFr) {
    return NextResponse.json({ error: "kind_and_name_required" }, { status: 400 });
  }

  const price = money(body.price);
  if (price === "invalid") return refuse("invalid_price", t("invalidPrice"));
  if (price === null) return refuse("price_required", t("priceRequired"));
  const categoryId = category(body.category_id);
  if (categoryId === "invalid") return refuse("invalid_category", t("categoryUnknown"));
  const isActive = body.is_active === true;
  if (unsellable({ kind, price, isActive })) return refuse("price_required", t("priceForSale"));

  const quota = posInt(body.listing_quota, 1000);
  const duration = posInt(body.duration_days, 3650);

  // The DB enforces these too (0157); catching them here turns a redacted 500
  // into a sentence the admin can act on.
  if ((kind === "listing_pack" || kind === "subscription") && !quota) {
    return refuse("quota_required", t("quotaRequired"));
  }
  if (kind === "badge_verified" && !duration) {
    return refuse("duration_required", t("durationRequired"));
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
      description_ar: text(body.description_ar, 500),
      price,
      category_id: categoryId,
      listing_quota: quota,
      duration_days: duration,
      is_active: isActive,
      sort_order: posInt(body.sort_order, 9999) ?? 100,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return refusedBy(error, t) ?? fail("product_create_failed", 500, error);

  logAction(req, user, "admin.product.create", { id: data.id, kind, slug });
  await audit(admin, user.id, { action: "product.create", targetType: "product", targetId: data.id, after: { kind, slug } });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req, "offres");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await jsonObject(req)) as Body;
  const t = await apiTranslator(req, "adminOffers.api");
  if (!isUuid(body.id)) return NextResponse.json({ error: "id_required" }, { status: 400 });
  const id = body.id;

  // Only the fields actually sent are touched, so a form that renders one row
  // can't blank the rest.
  const patch: Record<string, unknown> = {};
  if ("name_fr" in body) {
    const nameFr = text(body.name_fr, 120);
    if (!nameFr) return NextResponse.json({ error: "kind_and_name_required" }, { status: 400 });
    patch.name_fr = nameFr;
  }
  if ("name_ar" in body) patch.name_ar = text(body.name_ar, 120);
  if ("description" in body) patch.description = text(body.description, 500);
  if ("description_ar" in body) patch.description_ar = text(body.description_ar, 500);
  if ("price" in body) {
    const price = money(body.price);
    if (price === "invalid") return refuse("invalid_price", t("invalidPrice"));
    if (price === null) return refuse("price_required", t("priceRequired"));
    patch.price = price;
  }
  if ("category_id" in body) {
    const categoryId = category(body.category_id);
    if (categoryId === "invalid") return refuse("invalid_category", t("categoryUnknown"));
    patch.category_id = categoryId;
  }
  if ("listing_quota" in body) patch.listing_quota = posInt(body.listing_quota, 1000);
  if ("duration_days" in body) patch.duration_days = posInt(body.duration_days, 3650);
  if ("is_active" in body) patch.is_active = body.is_active === true;
  if ("sort_order" in body) patch.sort_order = posInt(body.sort_order, 9999) ?? 100;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // The fields as they were, for the audit trail — and the row as it will be,
  // for the one rule that spans two fields: on sale at a price nobody can pay.
  const columns = new Set([...Object.keys(patch), "kind", "price", "is_active"]);
  const { data: wasRow } = await admin.from("products").select([...columns].join(", ")).eq("id", id).maybeSingle();
  if (!wasRow) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const was = wasRow as unknown as Record<string, unknown>;
  const row = was as unknown as { kind: ProductKind; price: number | string; is_active: boolean };
  const next = {
    kind: row.kind,
    price: "price" in patch ? (patch.price as number) : Number(row.price),
    isActive: "is_active" in patch ? (patch.is_active as boolean) : row.is_active,
  };
  if (unsellable(next)) return refuse("price_required", t("priceForSale"));

  const { data: updated, error } = await admin.from("products").update(patch).eq("id", id).select("id");
  if (error) return refusedBy(error, t) ?? fail("product_update_failed", 500, error);
  if (!updated || updated.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, was[k]]));
  logAction(req, user, "admin.product.update", { id, fields: Object.keys(patch) });
  await audit(admin, user.id, { action: "product.update", targetType: "product", targetId: id, before, after: patch });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req, "offres");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "id_required" }, { status: 400 });

  // Deactivate, never delete: sellers hold credits bought under this row, and
  // the payments that funded them point at it.
  const { data: updated, error } = await admin.from("products").update({ is_active: false }).eq("id", id).select("id");
  if (error) return fail("product_deactivate_failed", 500, error);
  if (!updated || updated.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  logAction(req, user, "admin.product.deactivate", { id });
  await audit(admin, user.id, { action: "product.deactivate", targetType: "product", targetId: id, after: { is_active: false } });
  return NextResponse.json({ ok: true, deactivated: true });
}
