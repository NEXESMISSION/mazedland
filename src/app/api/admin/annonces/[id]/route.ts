import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { publishListing } from "@/lib/listings/publish";
import { takeDownListing } from "@/lib/listings/takedown";
import { asDealType, closedStatus } from "@/lib/listings/deal";
import { applyEdit, asPendingEdit, dropEdit } from "@/lib/listings/edit";
import { getSettings } from "@/lib/settings/server";
import { missingObjects, missingPhotos } from "@/lib/listings/storage";
import { MAX_PRICE, phone, titleTooShort } from "@/lib/listings/input";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

/**
 * Everything an admin can do to one annonce.
 *
 *   POST { action: "approve" }              → live for `duration_days`
 *   POST { action: "reject", reason }       → back to the seller, credit returned
 *   POST { action: "archive" }              → taken down, no refund
 *   POST { action: "mark_paid" }            → capture the receipt, queue for review
 *   POST { action: "waive_fee" }            → comp it, queue for review
 *   POST { action: "republish" }            → expired/archived/rejected → live again
 *   POST { action: "extend", days? }        → push `expires_at` out (default `listing_default_days`)
 *   POST { action: "feature", days? }       → put it on the home page
 *   POST { action: "unfeature" }            → take it off
 *   POST { action: "mark_sold" }            → the car is gone, keep the record
 *   POST { action: "edit", fields }         → fix what the seller typed
 *   POST { action: "delete" }               → remove it entirely (guarded)
 *
 * Approving is where a listing gets its `published_at` / `expires_at`, taken
 * from the product that paid for it — so changing the standard duration in
 * Tarifs changes the next publication, with no code involved.
 *
 * Two differences from Auto, both because Land is earlier in the pivot:
 *
 * - **No feature / unfeature.** Those write `featured_rank` and
 *   `featured_until`, which Land's `listings` does not have. Land curates its
 *   home page through its own screen; adding the actions here would mean
 *   adding columns nothing else reads yet.
 * - **Rejecting cannot return a credit**, because Land has no credits ledger
 *   (Auto's 0158 is not ported). Today that is moot — `seller_credit_id` is
 *   null on every Land listing since nothing can grant one — but the branch
 *   below refuses loudly rather than pretending, so the day packs ship this
 *   fails visibly instead of quietly keeping a seller's publication.
 */

/** Where an approval may start: what the seller sent, its fee settled or
 *  not. A draft is the seller's until they submit it — approving one put
 *  online what nobody had asked to publish. */
const APPROVE_FROM: readonly string[] = ["pending_review", "pending_payment"];
/** `republish` reaches further back, to an annonce that left the catalogue —
 *  never into a draft either. */
const REPUBLISH_FROM: readonly string[] = [...APPROVE_FROM, "expired", "archived", "rejected"];

/** Clamp a caller-supplied day count. Unbounded input here would let a typo
 *  put an annonce online until 2124. */
function days(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(1, Math.round(n)));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req, "annonces");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await ctx.params;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await jsonObject(req)) as {
    action?: unknown;
    reason?: unknown;
    days?: unknown;
    fields?: unknown;
  };
  let action = typeof body.action === "string" ? body.action : "";
  // The `detail` sentences below are shown to the moderator as-is, in the
  // language of the page that asked. Notification texts are not (yet).
  const t = await apiTranslator(req, "adminApi.listing");
  // A status in words (« en vérification »), not the enum (« pending_review »).
  const tStatus = await apiTranslator(req, "publishApi.statuses");
  const statusWord = (s: unknown) => (tStatus.has(String(s)) ? tStatus(String(s)) : String(s));

  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, seller_id, title, status, seller_credit_id, fee_payment_id, contact_phone, expires_at, deal_type, pending_edit, taken_down_at, shop_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });

  // Held offline for a seller's edit (0176): publishing or refusing it is
  // about the edit. A plain approve would put the old version online and
  // leave the edit hanging; a plain refusal would bury an approved annonce.
  if ((action === "approve" || action === "reject") && listing.status === "pending_review" && asPendingEdit(listing.pending_edit)) {
    action = `${action}_edit`;
  }

  // ── Settle the publication fee ────────────────────────────────────────────
  // Two ways a fee stops being owed:
  //
  //   "paid"   — the seller sent a receipt and it checks out. The payment is
  //              captured here rather than in the payments console, because
  //              this is the screen where the annonce is being looked at.
  //   "waived" — the money arrived some other way. Cash in hand happens, and
  //              refusing to publish over it just means the annonce never goes
  //              up. `fee_waived_by` records who decided, so the revenue
  //              reports show a gap rather than a silent free publication.
  //
  // Neither publishes on its own: the annonce moves to the review queue and is
  // published by the normal approve path, so nothing skips the check.
  if (action === "mark_paid" || action === "waive_fee") {
    if (listing.status !== "pending_payment" && listing.status !== "pending_review") {
      return NextResponse.json(
        { error: "not_awaiting_payment", detail: t("notAwaitingPayment", { status: statusWord(listing.status) }) },
        { status: 409 },
      );
    }

    if (action === "mark_paid") {
      if (!listing.fee_payment_id) {
        return NextResponse.json(
          { error: "no_payment", detail: t("noPayment") },
          { status: 400 },
        );
      }
      const { error } = await admin
        .from("payments")
        // reviewer_id / reviewed_at — the columns this table actually has.
        .update({
          status: "captured",
          reviewer_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", listing.fee_payment_id);
      if (error) return fail("payment_capture_failed", 500, error);
    }

    const { error: upErr } = await admin
      .from("listings")
      .update({
        status: "pending_review",
        rejection_reason: null,
        ...(action === "waive_fee" ? { fee_waived_by: user.id } : {}),
      })
      .eq("id", id);
    if (upErr) return fail("listing_update_failed", 500, upErr);

    await admin
      .rpc("enqueue_notification", {
        p_user_id: listing.seller_id,
        p_kind: "listing_payment_received",
        p_title: "Paiement enregistré",
        p_body: `« ${listing.title} » passe en vérification.`,
        p_link: "/account/listings",
        p_payload: { vars: { title: listing.title, variant: "recorded" } },
      })
      .then(() => {}, () => {});

    logAction(req, user, `admin.listing.${action}`, { id });
    return NextResponse.json({ ok: true, status: "pending_review" });
  }

  // ── Approve / republish ───────────────────────────────────────────────────
  // Same transition, two starting points. `republish` exists because an
  // expired or archived annonce had no way back online: the only publishing
  // path required `pending_review`, so a seller who rang up to say "it's still
  // for sale" had to create the whole thing again.
  if (action === "approve" || action === "republish") {
    if (!listing.contact_phone) {
      return NextResponse.json(
        { error: "contact_required", detail: t("noPhone") },
        { status: 400 },
      );
    }
    // Twice is not a second approval: it reset the expiry and told the seller again.
    if (listing.status === "published") {
      return NextResponse.json(
        { error: "already_published", detail: t("alreadyPublished") },
        { status: 409 },
      );
    }
    if (listing.status === "draft") {
      return NextResponse.json({ error: "not_submitted", detail: t("notSubmitted") }, { status: 409 });
    }
    const from = action === "approve" ? APPROVE_FROM : REPUBLISH_FROM;
    if (!from.includes(listing.status)) {
      return NextResponse.json(
        { error: "wrong_status", detail: t("notAwaitingReview", { status: statusWord(listing.status) }) },
        { status: 409 },
      );
    }
    // The same rule as the seller's submit: a photo row whose file never
    // arrived would go online as a broken image.
    if ((await missingPhotos(admin, id)).length > 0) {
      return NextResponse.json({ error: "photo_missing", detail: t("photoMissing") }, { status: 400 });
    }
    // An annonce of a closed agence waits: its page is gone with the agence.
    if (listing.shop_id) {
      const { data: shop } = await admin.from("shops").select("status").eq("id", listing.shop_id as string).maybeSingle();
      if (shop?.status !== "approved") {
        return NextResponse.json({ error: "shop_closed", detail: t("shopClosed") }, { status: 409 });
      }
    }

    // The same path the automatic publication takes (src/lib/listings/publish.ts):
    // dates, review state cleared, pending reports resolved, seller notified.
    // `from` makes the status test part of the write, so of two approvals a
    // moment apart only one publishes and the seller is told once.
    const published = await publishListing(
      admin,
      {
        id,
        seller_id: listing.seller_id as string,
        title: listing.title as string,
        fee_payment_id: (listing.fee_payment_id as string | null) ?? null,
      },
      { reviewerId: user.id, from },
    );
    if (!published.ok) {
      if (!published.wrongStatus) return fail("listing_publish_failed", 500, published.error);
      // Moved between the read above and the write — by a second click, or a
      // second moderator. Nothing was written; say what it is now.
      const { data: current } = await admin.from("listings").select("status").eq("id", id).maybeSingle();
      return current?.status === "published"
        ? NextResponse.json({ error: "already_published", detail: t("alreadyPublished") }, { status: 409 })
        : NextResponse.json({ error: "wrong_status", detail: t("statusChanged") }, { status: 409 });
    }
    const expires = published.expiresAt;

    logAction(req, user, `admin.listing.${action}`, { id, expires_at: expires.toISOString() });
    return NextResponse.json({ ok: true, status: "published", expires_at: expires.toISOString() });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    if (listing.status === "rejected") {
      return NextResponse.json({ error: "already_rejected", detail: t("alreadyRejected") }, { status: 409 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", detail: t("reasonRequired") },
        { status: 400 },
      );
    }

    // Auto returns the seller's publication credit here. Land has no credits
    // ledger yet, so there is nothing to give back — and rather than silently
    // skipping it, this refuses a rejection that WOULD have owed one. Today
    // the branch is unreachable (nothing grants a credit); the day packs ship
    // it fails loudly instead of quietly costing a seller a publication.
    //
    // It refuses BEFORE writing. It used to run after the update and before
    // the notification, so a forfait-paid annonce came back 409 to the
    // moderator — who reasonably read that as "nothing happened" — while the
    // row was already `rejected` and the seller had been told nothing at all.
    if (listing.seller_credit_id) {
      return NextResponse.json(
        {
          error: "credits_not_supported",
          detail: t("creditsNotSupported"),
        },
        { status: 409 },
      );
    }
    const creditReturned = false;

    // The status test is part of the write: refused a moment ago by a second
    // click or a second moderator, the seller has already been told.
    const { data: moved, error } = await admin
      .from("listings")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .neq("status", "rejected")
      .select("id");
    if (error) return fail("listing_reject_failed", 500, error);
    if (!moved || moved.length === 0) {
      return NextResponse.json({ error: "already_rejected", detail: t("alreadyRejected") }, { status: 409 });
    }

    await admin
      .rpc("enqueue_notification", {
        p_user_id: listing.seller_id,
        p_kind: "listing_rejected",
        p_title: "Annonce à corriger",
        p_body:
          `« ${listing.title} » n'a pas été publiée. Motif : ${reason}` +
          (creditReturned ? " Votre publication vous a été rendue." : ""),
        p_link: "/account/listings",
        p_payload: { vars: { title: listing.title, reason } },
      })
      .then(() => {}, () => {});

    logAction(req, user, "admin.listing.reject", { id, creditReturned });
    return NextResponse.json({ ok: true, status: "rejected", creditReturned });
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  // An admin's takedown, recorded as such (0190): the seller's « Remettre en
  // ligne » and « Renouveler » refuse while `taken_down_at` is set, and the
  // seller is told — with the reason, when the moderator gives one.
  if (action === "archive") {
    if (listing.taken_down_at) {
      return NextResponse.json({ error: "already_archived", detail: t("alreadyArchived") }, { status: 409 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    // The same marks and the same word to the seller as the bulk action
    // (src/lib/listings/takedown.ts) — and one takedown, however many clicks.
    const out = await takeDownListing(
      admin,
      { id, seller_id: listing.seller_id as string, title: listing.title as string },
      { byId: user.id, reason: reason || null },
    );
    if (!out.ok) {
      if (out.already) {
        return NextResponse.json({ error: "already_archived", detail: t("alreadyArchived") }, { status: 409 });
      }
      return fail("listing_archive_failed", 500, out.error);
    }

    logAction(req, user, "admin.listing.archive", { id, withReason: Boolean(reason) });
    return NextResponse.json({ ok: true, status: "archived" });
  }

  // ── Extend ────────────────────────────────────────────────────────────────
  // Counted from whichever is later — now, or the current expiry — so
  // extending an annonce that still has a week left adds to it instead of
  // quietly shortening it to today + N.
  if (action === "extend") {
    if (listing.status !== "published") {
      return NextResponse.json(
        { error: "not_published", detail: t("notPublished") },
        { status: 409 },
      );
    }
    const d = days(body.days, (await getSettings()).listing_default_days);
    const from = Math.max(Date.now(), new Date(listing.expires_at ?? 0).getTime());
    const expires = new Date(from + d * 86_400_000);

    const { error } = await admin
      .from("listings")
      .update({ expires_at: expires.toISOString() })
      .eq("id", id);
    if (error) return fail("listing_extend_failed", 500, error);

    logAction(req, user, "admin.listing.extend", { id, days: d });
    return NextResponse.json({ ok: true, expires_at: expires.toISOString() });
  }

  // ── Sold ──────────────────────────────────────────────────────────────────
  // Distinct from archived on purpose: "vendue" is the outcome the platform
  // exists to produce, and counting it is how we ever answer "does this work?".
  if (action === "mark_sold") {
    if (listing.status !== "published" && listing.status !== "expired") {
      return NextResponse.json(
        { error: "not_sellable", detail: t("notSellable", { status: statusWord(listing.status) }) },
        { status: 409 },
      );
    }
    // A rental closes as let, not sold — the outcome counted for each deal.
    const closed = closedStatus(asDealType(listing.deal_type));
    const { error } = await admin
      .from("listings")
      .update({
        status: closed,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return fail("listing_sold_failed", 500, error);

    logAction(req, user, "admin.listing.mark_sold", { id, status: closed });
    return NextResponse.json({ ok: true, status: closed });
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  // The corrections a moderator actually makes: a price typed with a zero too
  // many, a title in capitals, a wrong phone number. Deliberately a short
  // allow-list — category and attributes change what the annonce *is*, and
  // that belongs in the seller's own form, not in a moderation drawer.
  if (action === "edit") {
    const f = (body.fields ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    // The same bounds as the seller's form (src/lib/listings/input.ts): the
    // database refused a longer title or a wider price with a 500, and a
    // governorate or a phone that is not one went online as typed.
    if (typeof f.title === "string" && f.title.trim()) {
      const title = f.title.trim().slice(0, 140);
      if (titleTooShort(title)) return NextResponse.json({ error: "title_too_short", detail: t("titleTooShort") }, { status: 400 });
      patch.title = title;
    }
    if (typeof f.description === "string") patch.description = f.description.trim().slice(0, 5000) || null;
    if (typeof f.contact_name === "string") patch.contact_name = f.contact_name.trim().slice(0, 120) || null;
    if (typeof f.contact_phone === "string") {
      const p = phone(f.contact_phone);
      if (f.contact_phone.trim() && !p) return NextResponse.json({ error: "bad_phone", detail: t("badPhone") }, { status: 400 });
      patch.contact_phone = p;
    }
    if (typeof f.governorate === "string" && f.governorate.trim()) {
      const gov = f.governorate.trim();
      if (!(TUNISIAN_GOVERNORATES as readonly string[]).includes(gov)) {
        return NextResponse.json({ error: "bad_governorate", detail: t("badGovernorate") }, { status: 400 });
      }
      patch.governorate = gov;
    }
    if (typeof f.negotiable === "boolean") patch.negotiable = f.negotiable;
    if (typeof f.price_on_request === "boolean") patch.price_on_request = f.price_on_request;
    if (f.price === null) patch.price = null;
    else if (typeof f.price === "number" && Number.isFinite(f.price) && f.price >= 0 && f.price <= MAX_PRICE) {
      patch.price = Math.round(f.price * 100) / 100;
    } else if (f.price !== undefined) {
      return NextResponse.json({ error: "bad_price", detail: t("badPrice") }, { status: 400 });
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
    }

    // A published annonce with no phone is unreachable — the same rule the
    // publish path enforces, applied to the edit that could break it.
    if (
      listing.status === "published" &&
      "contact_phone" in patch &&
      !patch.contact_phone
    ) {
      return NextResponse.json(
        { error: "contact_required", detail: t("phoneRequiredLive") },
        { status: 400 },
      );
    }

    const { error } = await admin.from("listings").update(patch).eq("id", id);
    if (error) return fail("listing_edit_failed", 500, error);

    logAction(req, user, "admin.listing.edit", { id, fields: Object.keys(patch) });
    return NextResponse.json({ ok: true });
  }

  // ── A seller's edit of a live annonce (0172, 0176) ────────────────────────
  // Approve writes exactly what the seller sent and puts the annonce back
  // online; refuse discards it with a reason the seller reads, and the
  // approved version goes back online as it was.
  if (action === "approve_edit" || action === "reject_edit") {
    const edit = asPendingEdit(listing.pending_edit);
    if (!edit) return NextResponse.json({ error: "no_pending_edit", detail: t("noPendingEdit") }, { status: 409 });

    if (action === "approve_edit") {
      if (listing.status !== "published" && listing.status !== "pending_review") {
        return NextResponse.json({ error: "not_published", detail: t("editNotLive") }, { status: 409 });
      }
      // The gallery that goes online with the approval — the edit's, or the
      // one already there — has to be made of files, the same rule as approve.
      const gone = edit.photos
        ? await missingObjects(admin, "properties", edit.photos.map((p) => p.storage_path))
        : await missingPhotos(admin, id);
      if (gone.length > 0) {
        return NextResponse.json({ error: "photo_missing", detail: t("photoMissing") }, { status: 400 });
      }
      const out = await applyEdit(admin, id, edit, user.id);
      if (!out.ok) return fail("listing_edit_failed", 500, out.error);
      // Republished after expiring meanwhile: that path already told the seller.
      if (!out.republished) {
        await admin
          .rpc("enqueue_notification", {
            p_user_id: listing.seller_id,
            p_kind: "listing_edit_applied",
            p_title: "Modification publiée",
            p_body: `« ${listing.title} » est de nouveau en ligne, avec vos modifications.`,
            p_link: `/annonces/${id}`,
            p_payload: { vars: { title: listing.title } },
          })
          .then(() => {}, () => {});
      }
      logAction(req, user, "admin.listing.approve_edit", { id, republished: out.republished });
      return NextResponse.json({ ok: true, status: "published" });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) return NextResponse.json({ error: "reason_required", detail: t("reasonRequired") }, { status: 400 });
    const dropped = await dropEdit(admin, id);
    if (!dropped.ok) return fail("listing_edit_failed", 500, dropped.error);
    await admin
      .rpc("enqueue_notification", {
        p_user_id: listing.seller_id,
        p_kind: "listing_edit_rejected",
        p_title: "Modification refusée",
        p_body: `Les modifications de « ${listing.title} » n'ont pas été publiées. Motif : ${reason}. L'annonce reste telle qu'elle était avant.`,
        p_link: "/account/listings",
        p_payload: { vars: { title: listing.title, reason } },
      })
      .then(() => {}, () => {});
    logAction(req, user, "admin.listing.reject_edit", { id, status: dropped.status });
    return NextResponse.json({ ok: true, status: dropped.status });
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  // Guarded twice. A published annonce is archived instead — deleting one
  // breaks the link a buyer may be holding, and "archived" is reversible.
  // An annonce whose fee was actually paid is never deleted at all: the
  // payment row would point at nothing, and that is the record we need most
  // when a seller asks what they paid for.
  if (action === "delete") {
    if (listing.status === "published") {
      return NextResponse.json(
        {
          error: "published_not_deletable",
          detail: t("publishedNotDeletable"),
        },
        { status: 409 },
      );
    }
    if (listing.fee_payment_id) {
      const { data: pay } = await admin
        .from("payments")
        .select("status")
        .eq("id", listing.fee_payment_id)
        .maybeSingle();
      if (pay?.status === "captured") {
        return NextResponse.json(
          {
            error: "paid_not_deletable",
            detail: t("paidNotDeletable"),
          },
          { status: 409 },
        );
      }
    }

    // Photos and fitments cascade from the FK; the storage objects are left in
    // place deliberately — orphaned bytes are cheap, and a delete that also
    // wipes files is one that cannot be undone by re-inserting the row.
    const { error } = await admin.from("listings").delete().eq("id", id);
    if (error) return fail("listing_delete_failed", 500, error);

    logAction(req, user, "admin.listing.delete", { id, title: listing.title });
    return NextResponse.json({ ok: true, deleted: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
