import { NextRequest, NextResponse } from "next/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { parseShopInput } from "@/lib/pro/shops";

/**
 * PATCH /api/pro/shops/:id — the shop's page and contacts, by its owner or an
 * admin of it. `slug` may change too (a free one): the old address stops
 * working, so the form says so.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "edit_shop" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseShopInput(body, user.id);
  if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(`errors.${parsed.error}`) }, { status: 400 });

  const update: Record<string, unknown> = { ...parsed.value };
  // An image left out of the form keeps the one on file.
  if (!update.logo_path) delete update.logo_path;
  if (!update.cover_path) delete update.cover_path;

  if (typeof body.slug === "string" && body.slug.trim()) {
    const slug = body.slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 60) {
      return NextResponse.json({ error: "invalid", detail: t("errors.slug") }, { status: 400 });
    }
    const { data: other } = await admin.from("shops").select("id").eq("slug", slug).neq("id", id).maybeSingle();
    if (other) return NextResponse.json({ error: "conflict", detail: t("errors.slugTaken") }, { status: 409 });
    update.slug = slug;
  }

  const { error } = await admin.from("shops").update(update).eq("id", id);
  if (error) return fail("shop_update_failed", 500, error);
  logAction(req, user, "shop.update", { id });
  return NextResponse.json({ ok: true });
}
