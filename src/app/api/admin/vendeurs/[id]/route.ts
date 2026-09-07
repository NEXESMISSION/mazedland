import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Everything an admin can do to one account.
 *
 *   POST { action: "set_role", role }                → individual | agency | admin
 *   POST { action: "ban", reason } / { "unban" }
 *   POST { action: "grant_credits", product_id, quota?, months?, note? }
 *   POST { action: "grant_badge", months?, product_id?, note? }
 *   POST { action: "revoke_badge", reason }
 *
 * This consolidates `/api/admin/users/[id]` (role only) and
 * `/api/admin/sellers/[id]` (credits and badges) into one door, because they
 * were two halves of the same screen: whether someone is an agency, whether
 * they hold a badge and how many publications they have left are the same
 * question asked three ways.
 */

/** v3 roles. `bank`, `bailiff` and `inspector` are dropped (PIVOT-PLAN D6). */
const ROLES = new Set(["individual", "agency", "admin"]);

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await ctx.params;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, role, banned_at")
    .eq("id", id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // ── Role ──────────────────────────────────────────────────────────────────
  if (action === "set_role") {
    const role = typeof body.role === "string" ? body.role : "";
    if (!ROLES.has(role)) {
      return NextResponse.json({ error: "invalid", detail: "Rôle inconnu." }, { status: 400 });
    }
    // An admin removing their own admin rights locks themselves out of the
    // console with no way back in through the UI.
    if (id === user.id && role !== "admin") {
      return NextResponse.json(
        {
          error: "invalid",
          detail: "Vous ne pouvez pas retirer votre propre accès admin.",
        },
        { status: 400 },
      );
    }

    const { error } = await admin.from("profiles").update({ role }).eq("id", id);
    if (error) return fail("role_update_failed", 500, error);

    logAction(req, user, "admin.user.set_role", { id, role });
    return NextResponse.json({ ok: true, role });
  }

  // ── Ban ───────────────────────────────────────────────────────────────────
  if (action === "ban") {
    const reason = text(body.reason, 300);
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", detail: "Indiquez pourquoi ce compte est suspendu." },
        { status: 400 },
      );
    }
    if (id === user.id) {
      return NextResponse.json(
        { error: "invalid", detail: "Vous ne pouvez pas suspendre votre propre compte." },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from("profiles")
      .update({ banned_at: new Date().toISOString(), banned_reason: reason })
      .eq("id", id);
    if (error) return fail("ban_failed", 500, error);

    logAction(req, user, "admin.user.ban", { id });
    return NextResponse.json({ ok: true });
  }

  if (action === "unban") {
    const { error } = await admin
      .from("profiles")
      .update({ banned_at: null, banned_reason: null })
      .eq("id", id);
    if (error) return fail("unban_failed", 500, error);

    logAction(req, user, "admin.user.unban", { id });
    return NextResponse.json({ ok: true });
  }

  // ── Credits ───────────────────────────────────────────────────────────────
  // Granting by hand is the counterpart of "paiement manuel": a seller pays in
  // cash at the desk, or an agency is comped a batch. `granted_by` records who
  // decided, so the credits ledger never shows publications appearing from
  // nowhere.
  if (action === "grant_credits") {
    const productId = text(body.product_id, 40);
    if (!productId) {
      return NextResponse.json({ error: "invalid", detail: "Choisissez un forfait." }, { status: 400 });
    }
    const { data: product } = await admin
      .from("products")
      .select("listing_quota, duration_days, name_fr")
      .eq("id", productId)
      .maybeSingle();
    if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const override = Number(body.quota);
    const quota =
      Number.isFinite(override) && override > 0
        ? Math.min(1000, Math.floor(override))
        : Number(product.listing_quota);
    if (!Number.isFinite(quota) || quota <= 0) {
      return NextResponse.json(
        { error: "invalid", detail: "Ce forfait n'accorde aucune publication." },
        { status: 400 },
      );
    }

    const months = Number(body.months);
    const days =
      Number.isFinite(months) && months > 0
        ? Math.min(60, Math.floor(months)) * 30
        : Number(product.duration_days) || 365;

    const { error } = await admin.from("seller_credits").insert({
      seller_id: id,
      product_id: productId,
      quota_total: quota,
      quota_used: 0,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      status: "active",
      granted_by: user.id,
      note: text(body.note, 300),
    });
    if (error) return fail("credit_grant_failed", 500, error);

    await admin
      .rpc("enqueue_notification", {
        p_user_id: id,
        p_kind: "pack_purchased",
        p_title: "Forfait crédité",
        p_body: `${quota} publication${quota === 1 ? "" : "s"} ajoutée${quota === 1 ? "" : "s"} à votre compte.`,
        p_link: "/account/listings",
      })
      .then(() => {}, () => {});

    logAction(req, user, "admin.seller.grant_credits", { id, quota, productId });
    return NextResponse.json({ ok: true, quota });
  }

  // ── Badge ─────────────────────────────────────────────────────────────────
  if (action === "grant_badge") {
    const months = Number(body.months);
    const days = Number.isFinite(months) && months > 0 ? Math.min(60, Math.floor(months)) * 30 : 365;

    // One live badge per seller: re-granting extends rather than stacking, or
    // "revoke" would have to guess which of several rows it meant.
    await admin
      .from("seller_badges")
      .update({ revoked_at: new Date().toISOString(), revoke_reason: "remplacé" })
      .eq("seller_id", id)
      .is("revoked_at", null);

    const { error } = await admin.from("seller_badges").insert({
      seller_id: id,
      kind: "verified",
      product_id: text(body.product_id, 40),
      granted_by: user.id,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      note: text(body.note, 300),
    });
    if (error) return fail("badge_grant_failed", 500, error);

    await admin
      .rpc("enqueue_notification", {
        p_user_id: id,
        p_kind: "badge_granted",
        p_title: "Badge vendeur vérifié",
        p_body: "Votre badge est actif. Il apparaît sur toutes vos annonces.",
        p_link: "/account",
      })
      .then(() => {}, () => {});

    logAction(req, user, "admin.seller.grant_badge", { id, days });
    return NextResponse.json({ ok: true });
  }

  if (action === "revoke_badge") {
    const reason = text(body.reason, 300);
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", detail: "Indiquez pourquoi le badge est retiré." },
        { status: 400 },
      );
    }
    const { error } = await admin
      .from("seller_badges")
      .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
      .eq("seller_id", id)
      .is("revoked_at", null);
    if (error) return fail("badge_revoke_failed", 500, error);

    logAction(req, user, "admin.seller.revoke_badge", { id });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
