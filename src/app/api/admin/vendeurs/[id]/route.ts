import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { canOpen, type AdminSection } from "@/lib/admin/sections";
import { audit } from "@/lib/admin/audit";
import { otherFullAdmins } from "@/lib/admin/team";
import { PLACE_STATUSES } from "@/lib/places/model";

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
 *
 * One door, two sections of the team (src/lib/admin/sections.ts): roles and
 * bans are « vendeurs », credits and badges are money, so « paiements ». And
 * a console member's account — making one, unmaking one, banning one — is a
 * full admin's call (the team screen is where that is done properly).
 */

const ACTION_SECTION: Record<string, AdminSection> = {
  set_role: "vendeurs",
  ban: "vendeurs",
  unban: "vendeurs",
  grant_credits: "paiements",
  grant_badge: "paiements",
  revoke_badge: "paiements",
};

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
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const gate = await requireAdmin(req, ACTION_SECTION[action] ?? "vendeurs");
  if (gate instanceof NextResponse) return gate;
  const { user, scopes } = gate;
  const { id } = await ctx.params;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  // `detail` sentences are shown as-is, in the language of the page that asked.
  // Notification texts are not (yet).
  const t = await apiTranslator(req, "adminApi.sellers");

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, role, banned_at, admin_scopes")
    .eq("id", id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A console member's account, or making one, is the full admins' business.
  const touchesTeam =
    profile.role === "admin" || (action === "set_role" && body.role === "admin");
  if (touchesTeam && !canOpen(scopes, "equipe")) {
    return NextResponse.json({ error: "forbidden_section", section: "equipe" }, { status: 403 });
  }

  // ── Role ──────────────────────────────────────────────────────────────────
  if (action === "set_role") {
    const role = typeof body.role === "string" ? body.role : "";
    if (!ROLES.has(role)) {
      return NextResponse.json({ error: "invalid", detail: t("unknownRole") }, { status: 400 });
    }
    // An admin removing their own admin rights locks themselves out of the
    // console with no way back in through the UI.
    if (id === user.id && role !== "admin") {
      return NextResponse.json(
        {
          error: "invalid",
          detail: t("selfDemote"),
        },
        { status: 400 },
      );
    }

    // The last full admin cannot be demoted: nobody would be left to manage the team.
    if (profile.role === "admin" && role !== "admin" && profile.admin_scopes === null
        && (await otherFullAdmins(admin, id)) === 0) {
      return NextResponse.json({ error: "last_full_admin", detail: t("lastFullAdmin") }, { status: 409 });
    }

    // Made admin here = the whole console; scopes are given on the team screen.
    const { error } = await admin.from("profiles").update({ role, admin_scopes: null }).eq("id", id);
    if (error) return fail("role_update_failed", 500, error);

    logAction(req, user, "admin.user.set_role", { id, role });
    await audit(admin, user.id, {
      action: "user.set_role", targetType: "profile", targetId: id,
      before: { role: profile.role, admin_scopes: profile.admin_scopes }, after: { role, admin_scopes: null },
    });
    return NextResponse.json({ ok: true, role });
  }

  // ── Ban ───────────────────────────────────────────────────────────────────
  if (action === "ban") {
    const reason = text(body.reason, 300);
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", detail: t("banReasonRequired") },
        { status: 400 },
      );
    }
    if (id === user.id) {
      return NextResponse.json(
        { error: "invalid", detail: t("selfBan") },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { error } = await admin
      .from("profiles")
      .update({ banned_at: now, banned_reason: reason })
      .eq("id", id);
    if (error) return fail("ban_failed", 500, error);

    // « Ne pourra plus publier », kept (the QA tour, 2026-10-29): the login
    // is refused at the auth layer — the session dies at its next refresh —
    // and what they had online or in the queue comes down, recorded as an
    // admin's takedown (0190) so the seller cannot relist it. The routes that
    // write an annonce refuse the account meanwhile (src/lib/moderation/ban.ts).
    const { error: authErr } = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (authErr) return fail("ban_auth_failed", 500, authErr);
    const { data: down } = await admin
      .from("listings")
      .update({ status: "archived", taken_down_at: now, taken_down_by: user.id, taken_down_reason: reason, reviewed_by: user.id, reviewed_at: now })
      .eq("seller_id", id)
      .in("status", [...PLACE_STATUSES])
      .select("id");

    logAction(req, user, "admin.user.ban", { id, takenDown: down?.length ?? 0 });
    await audit(admin, user.id, {
      action: "user.ban", targetType: "profile", targetId: id,
      before: { banned_at: profile.banned_at }, after: { banned: true }, note: reason,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "unban") {
    const { error } = await admin
      .from("profiles")
      .update({ banned_at: null, banned_reason: null })
      .eq("id", id);
    if (error) return fail("unban_failed", 500, error);
    // The login works again. The annonces taken down stay down until an admin
    // republishes them one by one.
    const { error: authErr } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
    if (authErr) return fail("unban_auth_failed", 500, authErr);

    logAction(req, user, "admin.user.unban", { id });
    await audit(admin, user.id, {
      action: "user.unban", targetType: "profile", targetId: id,
      before: { banned_at: profile.banned_at }, after: { banned: false },
    });
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
      return NextResponse.json({ error: "invalid", detail: t("choosePack") }, { status: 400 });
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
        { error: "invalid", detail: t("packNoQuota") },
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
        p_payload: { vars: { quota } },
      })
      .then(() => {}, () => {});

    logAction(req, user, "admin.seller.grant_credits", { id, quota, productId });
    await audit(admin, user.id, {
      action: "credits.grant", targetType: "profile", targetId: id,
      after: { product_id: productId, quota, days }, note: text(body.note, 300),
    });
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
        p_payload: { vars: {} },
      })
      .then(() => {}, () => {});

    logAction(req, user, "admin.seller.grant_badge", { id, days });
    await audit(admin, user.id, {
      action: "badge.grant", targetType: "profile", targetId: id, after: { days }, note: text(body.note, 300),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "revoke_badge") {
    const reason = text(body.reason, 300);
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", detail: t("revokeReasonRequired") },
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
    await audit(admin, user.id, {
      action: "badge.revoke", targetType: "profile", targetId: id, after: { revoked: true }, note: reason,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
