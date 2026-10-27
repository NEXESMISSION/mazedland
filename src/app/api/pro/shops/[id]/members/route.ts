import { NextRequest, NextResponse } from "next/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { anyPhoneToE164 } from "@/lib/tunisia";
import { proGate } from "@/lib/pro/api";
import { canAssign, SHOP_ROLES, type ShopRole } from "@/lib/pro/shops";

/**
 * The shop's team (0173).
 *   POST   { phone, role }   add someone who already has a Mazed Immo account
 *   PATCH  { userId, role }  change a member's role
 *   DELETE { userId }        remove a member (never the owner)
 * The owner adds admins and agents; an admin adds agents only.
 */
function asRole(v: unknown): ShopRole | null {
  return SHOP_ROLES.find((r) => r === v) ?? null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "manage_members" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin, role: actor } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as { phone?: unknown; role?: unknown };
  const role = asRole(body.role);
  if (!role || !actor || !canAssign(actor, role)) return NextResponse.json({ error: "forbidden", detail: t("errors.role") }, { status: 403 });
  const phone = anyPhoneToE164(body.phone);
  if (!phone) return NextResponse.json({ error: "invalid", detail: t("errors.phone") }, { status: 400 });

  const { data: person } = await admin.from("profiles").select("id, full_name").eq("phone", phone).maybeSingle();
  if (!person) return NextResponse.json({ error: "not_found", detail: t("errors.noAccount") }, { status: 404 });

  const { error } = await admin
    .from("shop_members")
    .insert({ shop_id: id, user_id: person.id, role, invited_by: user.id });
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("errors.alreadyMember") }, { status: 409 });
  if (error) return fail("member_add_failed", 500, error);

  const { data: shop } = await admin.from("shops").select("name").eq("id", id).maybeSingle();
  await admin
    .rpc("enqueue_notification", {
      p_user_id: person.id,
      p_kind: "shop_member_added",
      p_title: "Vous rejoignez une agence",
      p_body: `Vous faites maintenant partie de « ${shop?.name ?? ""} » sur Mazed Immo.`,
      p_link: "/pro/dashboard",
      p_payload: { vars: { name: shop?.name ?? "" } },
    })
    .then(() => {}, () => {});
  logAction(req, user, "shop.member_add", { id, member: person.id, role });
  return NextResponse.json({ ok: true, name: person.full_name });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "manage_members" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin, role: actor } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown; role?: unknown };
  const role = asRole(body.role);
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!role || !actor || !canAssign(actor, role)) return NextResponse.json({ error: "forbidden", detail: t("errors.role") }, { status: 403 });

  const { data: member } = await admin.from("shop_members").select("role").eq("shop_id", id).eq("user_id", userId).maybeSingle();
  if (!member) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (member.role === "owner" || (actor === "admin" && member.role !== "agent")) {
    return NextResponse.json({ error: "forbidden", detail: t("errors.role") }, { status: 403 });
  }
  const { error } = await admin.from("shop_members").update({ role }).eq("shop_id", id).eq("user_id", userId);
  if (error) return fail("member_update_failed", 500, error);
  logAction(req, user, "shop.member_role", { id, member: userId, role });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "manage_members" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin, role: actor } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  const { data: member } = await admin.from("shop_members").select("role").eq("shop_id", id).eq("user_id", userId).maybeSingle();
  if (!member) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (member.role === "owner" || (actor === "admin" && member.role !== "agent")) {
    return NextResponse.json({ error: "forbidden", detail: t("errors.role") }, { status: 403 });
  }
  const { error } = await admin.from("shop_members").delete().eq("shop_id", id).eq("user_id", userId);
  if (error) return fail("member_remove_failed", 500, error);
  logAction(req, user, "shop.member_remove", { id, member: userId });
  return NextResponse.json({ ok: true });
}
