import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Receipt review — the v3 money queue.
 *
 *   POST { action: "accept" }           → captured; what that unlocks depends on kind
 *   POST { action: "reject", reason }   → failed, with a motif the seller sees
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
  const gate = await requireAdmin(req);
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

  if (pay.status !== "pending" && pay.status !== "pending_review") {
    return NextResponse.json(
      { error: "conflict", detail: `Ce paiement est déjà « ${pay.status} ».` },
      { status: 409 },
    );
  }
  if (!REVIEWABLE.has(pay.kind as string)) {
    return NextResponse.json(
      {
        error: "wrong_kind",
        detail: `« ${pay.kind} » appartient au produit enchères, qui n'existe plus.`,
      },
      { status: 400 },
    );
  }

  // ── Accept ────────────────────────────────────────────────────────────────
  if (action === "accept") {
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

    const meta = (pay.metadata ?? {}) as { product_id?: string };
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

    logAction(req, user, "admin.payment.accept", { id, kind: pay.kind, granted });
    return NextResponse.json({ ok: true, status: "captured", granted });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (reason.length < 5) {
      return NextResponse.json(
        {
          error: "reason_required",
          detail: "Dites au vendeur ce qui ne va pas — il doit pouvoir renvoyer un reçu valable.",
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
        })
        .then(() => {}, () => {});
    }

    logAction(req, user, "admin.payment.reject", { id, kind: pay.kind });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
