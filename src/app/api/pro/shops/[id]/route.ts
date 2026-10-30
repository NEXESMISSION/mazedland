import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { parseShopInput } from "@/lib/pro/shops";

/** What « vérifié » vouches for: the business behind the agence, as its papers name it. */
const IDENTITY = ["name", "legal_name", "legal_id"] as const;

/**
 * PATCH /api/pro/shops/:id — the shop's page and contacts, by its owner or an
 * admin of it. `slug` may change too (a free one): the old address stops
 * working, so the form says so.
 *
 * « Vérifié » means an admin checked who they are. A verified agence that
 * changes its name, its legal name or its registration number is another
 * business until an admin looks again: the mark comes off and the admins
 * are told (the QA tour, 2026-10-30, kept the badge through a change of
 * both). Contacts and the page's text change freely.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "edit_shop" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = await jsonObject(req);
  const parsed = parseShopInput(body, user.id);
  if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(`errors.${parsed.error}`) }, { status: 400 });

  const update: Record<string, unknown> = { ...parsed.value };
  // An image left out of the form keeps the one on file.
  if (!update.logo_path) delete update.logo_path;
  if (!update.cover_path) delete update.cover_path;

  const { data: stored } = await admin.from("shops").select("name, legal_name, legal_id, verified_at").eq("id", id).maybeSingle();
  const changed = stored?.verified_at ? IDENTITY.filter((k) => (stored[k] ?? null) !== (parsed.value[k] ?? null)) : [];
  if (changed.length > 0) {
    update.verified_at = null;
    update.verified_by = null;
  }

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
  if (changed.length > 0) {
    const was = stored?.name ?? "";
    await admin
      .rpc("_notify_admins", {
        p_kind: "admin_shop_pending",
        p_title: "Agence à revérifier",
        p_body: `« ${was} » a changé d'identité (${changed.join(", ")}) : le badge « vérifié » est retiré, contrôlez-la de nouveau.`,
        p_link: `/admin/agences?id=${id}`,
        p_payload: { vars: { variant: "reverify", name: was, fields: changed.join(", ") } },
      })
      .then(() => {}, () => {});
    logAction(req, user, "shop.reverify", { id, changed });
  }
  return NextResponse.json({ ok: true, reverify: changed.length > 0 });
}
