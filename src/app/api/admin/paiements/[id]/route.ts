import { NextRequest, NextResponse } from "next/server";
import { canBuy, placementOf, promoEnd } from "@/lib/promo";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { grantPlanPeriod } from "@/lib/pro/shops";
import { CREDIT_NOTE_REASONS, creditNoteReason } from "@/lib/payments/creditNote";

/**
 * Receipt review — the v3 money queue.
 *
 *   POST { action: "accept" }           → captured; what that unlocks depends on kind
 *   POST { action: "reject", reason }   → failed, with a motif the seller sees
 *   POST { action: "credit_note", reason: "test" | "refunded" | "mistake" }
 *                                       → a captured one cancelled by a credit note
 *
 * There was no working path to either. `/admin/payments` grouped receipts by
 * auction, and `auctions` is empty, so the queue returned nothing by
 * construction — three real `listing_fee` receipts have been sitting in
 * `pending_review` with nowhere to be seen.
 *
 * The database RPC could not have saved it either: `accept_listing_payment`
 * requires `payments.property_id is not null`, and every v3 fee carries its
 * subject in `metadata.listing_id` instead. It raises `payment_missing_property`
 * on all of them. So accepting is a plain status write here, and the
 * `_listing_fee_captured` trigger does the cascade it already knows how to do:
 * move the listing to `pending_review` and notify the seller.
 *
 * Rejection goes through `reject_listing_payment` because that RPC also writes
 * the seller's notification and enforces a real motif — but it is
 * SECURITY DEFINER and checks `is_admin()` against `auth.uid()`, so it must be
 * called with the *admin's* client, never the service client (which has no
 * `auth.uid()` and would be refused).
 */

/** Kinds this screen can settle. The auction kinds are gone. */
const REVIEWABLE = new Set([
  "listing_fee",
  "listing_pack",
  "subscription",
  "promo",
  "badge",
  "renewal",
]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req, "paiements");
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    reason?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "";

  const { data: pay } = await admin
    .from("payments")
    .select("id, user_id, kind, status, amount, metadata")
    .eq("id", id)
    .maybeSingle();
  if (!pay) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // `detail` is shown to the operator verbatim, in the page's language.
  const t = await apiTranslator(req, "adminPayments.api");

  // ── Credit note (0187) ────────────────────────────────────────────────────
  // A payment accepted that should not have been — a test, money given back.
  // Its invoice stays and keeps its number; a credit note cancels it, and what
  // the payment bought stops. issue_credit_note does it all in one
  // transaction, and writes the console's log line itself.
  if (action === "credit_note") {
    const reason = creditNoteReason(body.reason);
    if (!reason) {
      return NextResponse.json({ error: "reason_required", detail: t("creditReason") }, { status: 400 });
    }
    if (pay.status !== "captured") {
      return NextResponse.json(
        { error: "conflict", detail: t("creditNotCaptured", { status: String(pay.status) }) },
        { status: 409 },
      );
    }
    const { data: inv } = await admin.from("invoices").select("id").eq("payment_id", id).maybeSingle();
    if (!inv) return NextResponse.json({ error: "conflict", detail: t("creditNoInvoice") }, { status: 409 });
    const { data: noteId, error } = await admin.rpc("issue_credit_note", {
      p_invoice_id: inv.id,
      p_reason: CREDIT_NOTE_REASONS[reason],
      p_actor: user.id,
    });
    if (error) return fail("credit_note_failed", 500, error);
    logAction(req, user, "admin.payment.credit_note", { id, reason, credit_note: noteId });
    return NextResponse.json({ ok: true, status: "refunded", creditNote: noteId });
  }

  if (pay.status !== "pending" && pay.status !== "pending_review") {
    return NextResponse.json(
      { error: "conflict", detail: t("alreadyResolved", { status: String(pay.status) }) },
      { status: 409 },
    );
  }
  if (!REVIEWABLE.has(pay.kind as string)) {
    return NextResponse.json(
      {
        error: "wrong_kind",
        detail: t("wrongKind", { kind: String(pay.kind) }),
      },
      { status: 400 },
    );
  }

  // ── Accept ────────────────────────────────────────────────────────────────
  if (action === "accept") {
    // A payment is accepted on its receipt. On 2026-10-28 a Pro 59 DT with no
    // receipt — a choice the agence had dropped for Business — was accepted
    // and invoiced. Nothing to pay (an upgrade fully covered) needs none.
    if (pay.status !== "pending_review" && Number(pay.amount) > 0) {
      return NextResponse.json({ error: "conflict", detail: t("noReceipt") }, { status: 409 });
    }
    const { error } = await admin
      .from("payments")
      .update({
        status: "captured",
        reviewer_id: user.id,
        reviewed_at: new Date().toISOString(),
        admin_notes: null,
      })
      .eq("id", id)
      // Re-assert the state we read: two admins on the queue at once must not
      // both capture the same receipt.
      .in("status", ["pending", "pending_review"]);
    if (error) return fail("capture_failed", 500, error);

    const meta = (pay.metadata ?? {}) as { product_id?: string; shop_id?: string; listing_id?: string; product_slug?: string; change?: string };
    let granted: string | null = null;

    // A pack is only worth money if the credits actually appear. Nothing in
    // the database does this for us — `_listing_fee_captured` handles fees and
    // `_on_payment_captured` is auction machinery — so it happens here.
    if (pay.kind === "listing_pack" && meta.product_id) {
      const { data: product } = await admin
        .from("products")
        .select("listing_quota, duration_days, name_fr")
        .eq("id", meta.product_id)
        .maybeSingle();
      const quota = Number(product?.listing_quota);
      if (Number.isFinite(quota) && quota > 0) {
        // D9: prepaid credits expire after 12 months unless the product says
        // otherwise. Credits with no expiry are an open-ended liability.
        const days = Number(product?.duration_days);
        const expires = new Date(
          Date.now() + (Number.isFinite(days) && days > 0 ? days : 365) * 86_400_000,
        );
        const { error: credErr } = await admin.from("seller_credits").insert({
          seller_id: pay.user_id,
          product_id: meta.product_id,
          payment_id: pay.id,
          quota_total: quota,
          quota_used: 0,
          expires_at: expires.toISOString(),
          status: "active",
          granted_by: user.id,
        });
        if (credErr) return fail("credit_grant_failed", 500, credErr);
        granted = `${quota} publications`;
      }
    }

    // A plan (0173): one period of the plan for the shop — at once for a
    // bigger plan than the one running, with the time left on the smaller one
    // added to it, else when what is paid for ends (grantPlanPeriod). The
    // payment id is unique on the period, so the same receipt never grants
    // twice.
    if (pay.kind === "subscription" && meta.product_id && meta.shop_id) {
      const { data: product } = await admin
        .from("products")
        .select("listing_quota, duration_days, name_fr")
        .eq("id", meta.product_id)
        .maybeSingle();
      const quota = Number(product?.listing_quota);
      const days = Number(product?.duration_days);
      if (!(Number.isFinite(quota) && quota > 0)) return fail("subscription_product_invalid", 500);
      const period = await grantPlanPeriod(admin, {
        shopId: meta.shop_id,
        productId: meta.product_id,
        paymentId: pay.id,
        quota,
        days: Number.isFinite(days) && days > 0 ? days : 30,
        grantedBy: user.id,
        // Quoted before 2026-10-28: full price, so the old days-carried rule.
        legacy: !meta.change,
      });
      if ("error" in period) return fail("subscription_grant_failed", 500, period.error);
      granted = `${product?.name_fr ?? "Pro"} jusqu'au ${period.endsAt.toISOString().slice(0, 10)}`
        + (period.carriedDays > 0 ? ` (+${period.carriedDays} j reportés)` : "");
    }

    if (pay.kind === "badge" && meta.product_id) {
      const { data: product } = await admin
        .from("products")
        .select("duration_days")
        .eq("id", meta.product_id)
        .maybeSingle();
      const days = Number(product?.duration_days);
      // D10: the badge lasts 12 months unless the product sets otherwise.
      const expires = new Date(
        Date.now() + (Number.isFinite(days) && days > 0 ? days : 365) * 86_400_000,
      );
      const { error: badgeErr } = await admin.from("seller_badges").insert({
        seller_id: pay.user_id,
        kind: "verified",
        product_id: meta.product_id,
        payment_id: pay.id,
        granted_by: user.id,
        expires_at: expires.toISOString(),
      });
      if (badgeErr) return fail("badge_grant_failed", 500, badgeErr);
      granted = "badge vérifié";
    }

    // A placement (0156): on the annonce from now — or from where the same one
    // ends — for the product's days. Bought, so not « manual ».
    let promo: { title: string; until: Date } | null = null;
    if (pay.kind === "promo" && meta.listing_id) {
      const column = placementOf(meta.product_slug);
      const { data: product } = await admin
        .from("products")
        .select("slug, duration_days")
        .eq("id", meta.product_id ?? "")
        .maybeSingle();
      const placement = column ?? placementOf(product?.slug as string | undefined);
      const { data: l } = await admin
        .from("listings")
        .select("title, promo_home_featured, promo_top_listed, promo_banner, promo_expires_at")
        .eq("id", meta.listing_id)
        .maybeSingle();
      if (!placement || !l) return fail("promo_grant_failed", 500);
      const days = Number(product?.duration_days) > 0 ? Number(product?.duration_days) : 30;
      // A different placement still running (bought by another route, or granted
      // by an admin) gives way to the paid one.
      const until = canBuy(l, placement) ? promoEnd(l, placement, days) : new Date(Date.now() + days * 86_400_000);
      const { error: promoErr } = await admin
        .from("listings")
        .update({
          promo_home_featured: placement === "promo_home_featured",
          promo_top_listed: placement === "promo_top_listed",
          promo_banner: placement === "promo_banner",
          promo_expires_at: until.toISOString(),
          promo_manual: false,
        })
        .eq("id", meta.listing_id);
      if (promoErr) return fail("promo_grant_failed", 500, promoErr);
      promo = { title: l.title as string, until };
      granted = `${placement} jusqu'au ${until.toISOString().slice(0, 10)}`;
    }

    // The payer hears it — the fee of an annonce already does, through its own
    // trigger (_listing_fee_captured); every other receipt did not, so a Pro
    // plan or a badge started in silence.
    if (pay.kind !== "listing_fee") {
      await admin
        .rpc("enqueue_notification", {
          p_user_id: pay.user_id,
          p_kind: "payment_accepted",
          p_title: promo ? "Mise en avant active" : "Paiement validé",
          p_body: promo
            ? `La mise en avant de « ${promo.title} » est active jusqu'au ${promo.until.toISOString().slice(0, 10)}.`
            : `Votre paiement de ${pay.amount} TND est validé.`,
          p_link: promo && meta.listing_id ? `/annonces/${meta.listing_id}` : meta.shop_id ? "/pro/dashboard" : "/account/payments",
          p_payload: promo
            ? { vars: { variant: "promo", title: promo.title, expires_at: promo.until.toISOString() }, focus: pay.id }
            : { vars: { variant: "plain", amount: Number(pay.amount), paymentKind: pay.kind }, focus: pay.id },
        })
        .then(() => {}, () => {});
    }

    logAction(req, user, "admin.payment.accept", { id, kind: pay.kind, granted });
    await audit(admin, user.id, {
      action: "payment.accept", targetType: "payment", targetId: id,
      before: { status: pay.status }, after: { status: "captured", kind: pay.kind, amount: pay.amount, granted },
    });
    return NextResponse.json({ ok: true, status: "captured", granted });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (reason.length < 5) {
      return NextResponse.json(
        {
          error: "reason_required",
          detail: t("reasonRequired"),
        },
        { status: 400 },
      );
    }

    if (pay.kind === "listing_fee") {
      // The RPC writes the notification and the audit fields together, and it
      // runs as the admin (it checks is_admin() against auth.uid()).
      const { error } = await supabase.rpc("reject_listing_payment", {
        p_payment_id: id,
        p_reason: reason,
      });
      if (error) return fail("reject_failed", 500, error);
    } else {
      const { error } = await admin
        .from("payments")
        .update({
          status: "failed",
          admin_notes: reason,
          reviewer_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .in("status", ["pending", "pending_review"]);
      if (error) return fail("reject_failed", 500, error);

      await admin
        .rpc("enqueue_notification", {
          p_user_id: pay.user_id,
          p_kind: "payment_rejected",
          p_title: "Reçu refusé",
          p_body: `Motif : ${reason}. Vous pouvez en envoyer un nouveau.`,
          p_link: "/account/payments",
          p_payload: { vars: { reason } },
        })
        .then(() => {}, () => {});
    }

    logAction(req, user, "admin.payment.reject", { id, kind: pay.kind });
    await audit(admin, user.id, {
      action: "payment.reject", targetType: "payment", targetId: id,
      before: { status: pay.status }, after: { status: "failed", kind: pay.kind, amount: pay.amount }, note: reason,
    });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
