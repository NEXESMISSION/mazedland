import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Everything an admin can do to one annonce.
 *
 *   POST { action: "approve" }              → live for `duration_days`
 *   POST { action: "reject", reason }       → back to the seller, credit returned
 *   POST { action: "archive" }              → taken down, no refund
 *   POST { action: "mark_paid" }            → capture the receipt, queue for review
 *   POST { action: "waive_fee" }            → comp it, queue for review
 *   POST { action: "republish" }            → expired/archived/rejected → live again
 *   POST { action: "extend", days? }        → push `expires_at` out (default 30)
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

const DEFAULT_DURATION_DAYS = 30;

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** How long a publication lasts: what its payment bought, else the active
 *  `listing_single` product, else 30 days. Never a constant in a caller. */
async function publicationDays(admin: Admin, feePaymentId: string | null): Promise<number> {
  if (feePaymentId) {
    const { data: pay } = await admin
      .from("payments")
      .select("metadata")
      .eq("id", feePaymentId)
      .maybeSingle();
    const d = Number((pay?.metadata as { duration_days?: unknown } | null)?.duration_days);
    if (Number.isFinite(d) && d > 0) return d;
  }
  const { data: prod } = await admin
    .from("products")
    .select("duration_days")
    .eq("kind", "listing_single")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const d = Number(prod?.duration_days);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION_DAYS;
}

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
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await ctx.params;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    reason?: unknown;
    days?: unknown;
    fields?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "";

  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, seller_id, title, status, seller_credit_id, fee_payment_id, contact_phone, expires_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });

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
        { error: "not_awaiting_payment", detail: `Cette annonce est « ${listing.status} ».` },
        { status: 409 },
      );
    }

    if (action === "mark_paid") {
      if (!listing.fee_payment_id) {
        return NextResponse.json(
          { error: "no_payment", detail: "Aucun paiement n'est rattaché à cette annonce." },
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
        { error: "contact_required", detail: "Cette annonce n'a pas de numéro : elle ne peut pas être publiée." },
        { status: 400 },
      );
    }
    if (action === "republish" && listing.status === "published") {
      return NextResponse.json(
        { error: "already_published", detail: "Cette annonce est déjà en ligne." },
        { status: 409 },
      );
    }

    const d = await publicationDays(admin, listing.fee_payment_id);
    const now = new Date();
    const expires = new Date(now.getTime() + d * 86_400_000);

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
      .eq("id", id);
    if (error) return fail("listing_publish_failed", 500, error);

    await admin
      .rpc("enqueue_notification", {
        p_user_id: listing.seller_id,
        p_kind: "listing_published",
        p_title: "Votre annonce est en ligne",
        p_body: `« ${listing.title} » est visible jusqu'au ${expires.toLocaleDateString("fr-FR")}.`,
        p_link: `/annonces/${id}`,
      })
      .then(() => {}, () => {});

    logAction(req, user, `admin.listing.${action}`, { id, days: d });
    return NextResponse.json({ ok: true, status: "published", expires_at: expires.toISOString() });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", detail: "Dites au vendeur ce qui ne va pas — sinon il renverra la même annonce." },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from("listings")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return fail("listing_reject_failed", 500, error);

    // Auto returns the seller's publication credit here. Land has no credits
    // ledger yet, so there is nothing to give back — and rather than silently
    // skipping it, this refuses a rejection that WOULD have owed one. Today
    // the branch is unreachable (nothing grants a credit); the day packs ship
    // it fails loudly instead of quietly costing a seller a publication.
    if (listing.seller_credit_id) {
      return NextResponse.json(
        {
          error: "credits_not_supported",
          detail:
            "Cette annonce a été payée avec un forfait, et le remboursement de forfait n'existe pas encore ici. Traitez-la à la main.",
        },
        { status: 409 },
      );
    }
    const creditReturned = false;

    await admin
      .rpc("enqueue_notification", {
        p_user_id: listing.seller_id,
        p_kind: "listing_rejected",
        p_title: "Annonce à corriger",
        p_body:
          `« ${listing.title} » n'a pas été publiée. Motif : ${reason}` +
          (creditReturned ? " Votre publication vous a été rendue." : ""),
        p_link: "/account/listings",
      })
      .then(() => {}, () => {});

    logAction(req, user, "admin.listing.reject", { id, creditReturned });
    return NextResponse.json({ ok: true, status: "rejected", creditReturned });
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  if (action === "archive") {
    const { error } = await admin
      .from("listings")
      .update({ status: "archived", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return fail("listing_archive_failed", 500, error);

    logAction(req, user, "admin.listing.archive", { id });
    return NextResponse.json({ ok: true, status: "archived" });
  }

  // ── Extend ────────────────────────────────────────────────────────────────
  // Counted from whichever is later — now, or the current expiry — so
  // extending an annonce that still has a week left adds to it instead of
  // quietly shortening it to today + N.
  if (action === "extend") {
    if (listing.status !== "published") {
      return NextResponse.json(
        { error: "not_published", detail: "Seule une annonce en ligne peut être prolongée." },
        { status: 409 },
      );
    }
    const d = days(body.days, DEFAULT_DURATION_DAYS);
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
        { error: "not_sellable", detail: `Une annonce « ${listing.status} » ne peut pas être marquée vendue.` },
        { status: 409 },
      );
    }
    const { error } = await admin
      .from("listings")
      .update({
        status: "sold",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return fail("listing_sold_failed", 500, error);

    logAction(req, user, "admin.listing.mark_sold", { id });
    return NextResponse.json({ ok: true, status: "sold" });
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  // The corrections a moderator actually makes: a price typed with a zero too
  // many, a title in capitals, a wrong phone number. Deliberately a short
  // allow-list — category and attributes change what the annonce *is*, and
  // that belongs in the seller's own form, not in a moderation drawer.
  if (action === "edit") {
    const f = (body.fields ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof f.title === "string" && f.title.trim()) patch.title = f.title.trim().slice(0, 200);
    if (typeof f.description === "string") patch.description = f.description.trim().slice(0, 5000) || null;
    if (typeof f.contact_name === "string") patch.contact_name = f.contact_name.trim().slice(0, 120) || null;
    if (typeof f.contact_phone === "string") patch.contact_phone = f.contact_phone.trim().slice(0, 40) || null;
    if (typeof f.governorate === "string" && f.governorate.trim()) patch.governorate = f.governorate.trim();
    if (typeof f.negotiable === "boolean") patch.negotiable = f.negotiable;
    if (typeof f.price_on_request === "boolean") patch.price_on_request = f.price_on_request;
    if (f.price === null) patch.price = null;
    else if (typeof f.price === "number" && Number.isFinite(f.price) && f.price >= 0) {
      patch.price = f.price;
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
        { error: "contact_required", detail: "Une annonce en ligne doit garder un numéro." },
        { status: 400 },
      );
    }

    const { error } = await admin.from("listings").update(patch).eq("id", id);
    if (error) return fail("listing_edit_failed", 500, error);

    logAction(req, user, "admin.listing.edit", { id, fields: Object.keys(patch) });
    return NextResponse.json({ ok: true });
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
          detail: "Archivez d'abord : supprimer une annonce en ligne casse les liens partagés.",
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
            detail: "Cette annonce a été payée. Archivez-la — la trace du paiement doit rester.",
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
