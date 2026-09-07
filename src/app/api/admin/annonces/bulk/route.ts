import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * The same moderation actions, applied to a selection.
 *
 *   POST { ids: [...], action: "approve" | "archive" | "extend", days? }
 *
 * Why this exists as its own route rather than the client looping over the
 * single-id one: sixty-six annonces today, several hundred a month if this
 * works, and a morning's queue is mostly obvious approvals. Twenty sequential
 * round trips from the browser is twenty chances to half-finish — the tab gets
 * closed at number eleven and nobody knows which eleven.
 *
 * Two rules make it safe to hand an admin a checkbox and a button:
 *
 * - **`reject` and `delete` are not bulk actions.** A refusal needs a motif
 *   written for that seller, and a delete is irreversible. Neither should ever
 *   be something you do to twenty rows with one click.
 * - **It reports per-row outcomes, not a boolean.** Rows that could not move
 *   (no phone, wrong status) come back named, so the operator sees "18 publiées,
 *   2 sans numéro" instead of a success toast that quietly skipped two.
 */

const MAX = 50;
const DEFAULT_EXTEND_DAYS = 30;

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as {
    ids?: unknown;
    action?: unknown;
    days?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "";
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string").slice(0, MAX)
    : [];

  if (ids.length === 0) return NextResponse.json({ error: "no_ids" }, { status: 400 });
  if (!["approve", "archive", "extend"].includes(action)) {
    return NextResponse.json(
      {
        error: "unsupported_bulk_action",
        detail: "Le refus et la suppression se font une annonce à la fois.",
      },
      { status: 400 },
    );
  }

  const { data: rows, error: readErr } = await admin
    .from("listings")
    .select("id, title, status, contact_phone, expires_at, fee_payment_id, seller_id")
    .in("id", ids);
  if (readErr) return fail("listings_read_failed", 500, readErr);

  const found = rows ?? [];
  const ok: string[] = [];
  const skipped: { id: string; title: string; why: string }[] = [];

  if (action === "approve") {
    // One product lookup for the whole batch rather than one per row.
    const { data: prod } = await admin
      .from("products")
      .select("duration_days")
      .eq("kind", "listing_single")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const fallbackDays =
      Number.isFinite(Number(prod?.duration_days)) && Number(prod?.duration_days) > 0
        ? Number(prod!.duration_days)
        : 30;

    const now = new Date();
    for (const r of found) {
      if (r.status !== "pending_review") {
        skipped.push({ id: r.id, title: r.title, why: `statut « ${r.status} »` });
        continue;
      }
      if (!r.contact_phone) {
        skipped.push({ id: r.id, title: r.title, why: "aucun numéro" });
        continue;
      }
      const expires = new Date(now.getTime() + fallbackDays * 86_400_000);
      const { error } = await admin
        .from("listings")
        .update({
          status: "published",
          published_at: now.toISOString(),
          expires_at: expires.toISOString(),
          reviewed_by: user.id,
          reviewed_at: now.toISOString(),
          rejection_reason: null,
        })
        .eq("id", r.id);
      if (error) {
        skipped.push({ id: r.id, title: r.title, why: "erreur serveur" });
        continue;
      }
      ok.push(r.id);
      await admin
        .rpc("enqueue_notification", {
          p_user_id: r.seller_id,
          p_kind: "listing_published",
          p_title: "Votre annonce est en ligne",
          p_body: `« ${r.title} » est visible jusqu'au ${expires.toLocaleDateString("fr-FR")}.`,
          p_link: `/annonces/${r.id}`,
        })
        .then(() => {}, () => {});
    }
  }

  if (action === "archive") {
    const movable = found.filter((r) => r.status !== "archived");
    for (const r of found) {
      if (r.status === "archived") skipped.push({ id: r.id, title: r.title, why: "déjà archivée" });
    }
    if (movable.length > 0) {
      const { error } = await admin
        .from("listings")
        .update({
          status: "archived",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .in("id", movable.map((r) => r.id));
      if (error) return fail("bulk_archive_failed", 500, error);
      ok.push(...movable.map((r) => r.id));
    }
  }

  if (action === "extend") {
    const n = Number(body.days);
    const d = Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : DEFAULT_EXTEND_DAYS;
    for (const r of found) {
      if (r.status !== "published") {
        skipped.push({ id: r.id, title: r.title, why: "pas en ligne" });
        continue;
      }
      // Extend from the later of now and the current expiry, so a batch never
      // shortens the annonces that still had time left.
      const from = Math.max(Date.now(), new Date(r.expires_at ?? 0).getTime());
      const { error } = await admin
        .from("listings")
        .update({ expires_at: new Date(from + d * 86_400_000).toISOString() })
        .eq("id", r.id);
      if (error) skipped.push({ id: r.id, title: r.title, why: "erreur serveur" });
      else ok.push(r.id);
    }
  }

  // Ids that matched nothing — a stale selection after someone else moved them.
  for (const id of ids) {
    if (!found.some((r) => r.id === id)) {
      skipped.push({ id, title: "—", why: "introuvable" });
    }
  }

  logAction(req, user, `admin.listing.bulk_${action}`, {
    requested: ids.length,
    applied: ok.length,
    skipped: skipped.length,
  });

  return NextResponse.json({ ok: true, applied: ok.length, skipped });
}
