import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { publishListing } from "@/lib/listings/publish";
import { takeDownListing } from "@/lib/listings/takedown";
import { missingPhotos } from "@/lib/listings/storage";
import { isUuid } from "@/lib/uuid";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * The same moderation actions, applied to a selection.
 *
 *   POST { ids: [...], action: "approve" | "archive" | "extend", days?, reason? }
 *
 * `reason` goes with `archive`: one motif for the batch, sent to every seller
 * like the single action's.
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
  const gate = await requireAdmin(req, "annonces");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await jsonObject(req)) as {
    ids?: unknown;
    action?: unknown;
    days?: unknown;
    reason?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "";
  // `detail` and each skipped row's `why` are shown to the moderator as-is,
  // in the language of the page that asked.
  const t = await apiTranslator(req, "adminApi.bulk");
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string").slice(0, MAX)
    : [];

  if (ids.length === 0) return NextResponse.json({ error: "no_ids" }, { status: 400 });
  // Not a uuid: Postgres would answer with a cast error, a 500 for the console.
  if (ids.some((x) => !isUuid(x))) return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  if (!["approve", "archive", "extend"].includes(action)) {
    return NextResponse.json(
      {
        error: "unsupported_bulk_action",
        detail: t("unsupported"),
      },
      { status: 400 },
    );
  }

  const { data: rows, error: readErr } = await admin
    .from("listings")
    .select("id, title, status, contact_phone, expires_at, fee_payment_id, seller_id, pending_edit_at")
    .in("id", ids);
  if (readErr) return fail("listings_read_failed", 500, readErr);

  const found = rows ?? [];
  const ok: string[] = [];
  const skipped: { id: string; title: string; why: string }[] = [];

  if (action === "approve") {
    for (const r of found) {
      if (r.status !== "pending_review") {
        skipped.push({ id: r.id, title: r.title, why: t("skipStatus", { status: r.status }) });
        continue;
      }
      if (!r.contact_phone) {
        skipped.push({ id: r.id, title: r.title, why: t("skipNoPhone") });
        continue;
      }
      // Held for a seller's edit (0176): approving here would put the old
      // version online. The edit is read and decided on from its own sheet.
      if (r.pending_edit_at) {
        skipped.push({ id: r.id, title: r.title, why: t("skipEditWaiting") });
        continue;
      }
      if ((await missingPhotos(admin, r.id)).length > 0) {
        skipped.push({ id: r.id, title: r.title, why: t("skipPhotoMissing") });
        continue;
      }
      // The same path as a single approval and the automatic publication
      // (src/lib/listings/publish.ts): the dates, the review state, the
      // reports, the seller's notification — and the buyers whose demande
      // this annonce answers, whom this loop used to skip. `from` makes the
      // status part of the write: a row another moderator just published is
      // reported, not published again.
      const published = await publishListing(
        admin,
        { id: r.id, seller_id: r.seller_id, title: r.title, fee_payment_id: (r.fee_payment_id as string | null) ?? null },
        { reviewerId: user.id, from: ["pending_review"] },
      );
      if (!published.ok) {
        skipped.push({ id: r.id, title: r.title, why: published.wrongStatus ? t("skipChanged") : t("skipServerError") });
        continue;
      }
      ok.push(r.id);
    }
  }

  if (action === "archive") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    for (const r of found) {
      if (r.status === "archived") {
        skipped.push({ id: r.id, title: r.title, why: t("skipAlreadyArchived") });
        continue;
      }
      // An admin's takedown (0190), through the same helper as the single
      // action: the seller cannot relist what the console took down, and is
      // told so, with the motif — this path used to leave them wondering.
      const out = await takeDownListing(
        admin,
        { id: r.id, seller_id: r.seller_id, title: r.title },
        { byId: user.id, reason: reason || null },
      );
      if (!out.ok) {
        skipped.push({ id: r.id, title: r.title, why: out.already ? t("skipAlreadyArchived") : t("skipServerError") });
        continue;
      }
      ok.push(r.id);
    }
  }

  if (action === "extend") {
    const n = Number(body.days);
    const d = Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : DEFAULT_EXTEND_DAYS;
    for (const r of found) {
      if (r.status !== "published") {
        skipped.push({ id: r.id, title: r.title, why: t("skipNotPublished") });
        continue;
      }
      // Extend from the later of now and the current expiry, so a batch never
      // shortens the annonces that still had time left.
      const from = Math.max(Date.now(), new Date(r.expires_at ?? 0).getTime());
      const { error } = await admin
        .from("listings")
        .update({ expires_at: new Date(from + d * 86_400_000).toISOString() })
        .eq("id", r.id);
      if (error) skipped.push({ id: r.id, title: r.title, why: t("skipServerError") });
      else ok.push(r.id);
    }
  }

  // Ids that matched nothing — a stale selection after someone else moved them.
  for (const id of ids) {
    if (!found.some((r) => r.id === id)) {
      skipped.push({ id, title: "—", why: t("skipNotFound") });
    }
  }

  logAction(req, user, `admin.listing.bulk_${action}`, {
    requested: ids.length,
    applied: ok.length,
    skipped: skipped.length,
  });

  return NextResponse.json({ ok: true, applied: ok.length, skipped });
}
