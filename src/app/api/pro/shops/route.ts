import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { parseShopInput, slugify } from "@/lib/pro/shops";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/pro/shops — open a shop (0173). One shop per owner. It waits for
 * an admin (status pending) before it shows on the site; its owner can set
 * it up meanwhile.
 */
export async function POST(req: NextRequest) {
  const off = await featureOff("feature_pro_signup");
  if (off) return off;
  const gate = await proGate(req);
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const { limit_shop_create_per_hour: perHour } = await getSettings();
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `shop-create:${user.id}`, p_max: perHour, p_window_secs: 3600 });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data: owned } = await admin.from("shops").select("id").eq("owner_id", user.id).limit(1);
  if (owned && owned.length > 0) return NextResponse.json({ error: "conflict", detail: t("oneShop") }, { status: 409 });

  const parsed = parseShopInput((await req.json().catch(() => ({}))) as Record<string, unknown>, user.id);
  if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(`errors.${parsed.error}`) }, { status: 400 });

  // A free address: the name's, or the name's with a short suffix.
  let slug = slugify(parsed.value.name, randomBytes(4).toString("hex"));
  const { data: taken } = await admin.from("shops").select("id").eq("slug", slug).maybeSingle();
  if (taken) slug = `${slug.slice(0, 50)}-${randomBytes(2).toString("hex")}`;

  const { data: shop, error } = await admin
    .from("shops")
    .insert({ ...parsed.value, slug, owner_id: user.id, status: "pending" })
    .select("id, slug, name")
    .single();
  if (error || !shop) return fail("shop_create_failed", 500, error);

  const { error: mErr } = await admin.from("shop_members").insert({ shop_id: shop.id, user_id: user.id, role: "owner", invited_by: user.id });
  if (mErr) {
    await admin.from("shops").delete().eq("id", shop.id);
    return fail("shop_create_failed", 500, mErr);
  }

  await admin
    .rpc("_notify_admins", {
      p_kind: "admin_shop_pending",
      p_title: "Agence à valider",
      p_body: `« ${shop.name} » demande à ouvrir son agence.`,
      p_link: `/admin/agences?id=${shop.id}`,
      p_payload: { vars: { name: shop.name } },
    })
    .then(() => {}, () => {});

  logAction(req, user, "shop.create", { id: shop.id });
  return NextResponse.json({ ok: true, id: shop.id, slug: shop.slug });
}
