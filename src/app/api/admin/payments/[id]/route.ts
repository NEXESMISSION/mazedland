import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Admin receipt review.
 *
 * PATCH body:
 *   {
 *     verdict: "captured" | "failed",
 *     notes?: string,   // required when verdict === "failed"
 *   }
 *
 * accept (captured):
 *   - Flips payments.status to 'captured'.
 *   - Downstream DB triggers (`_on_payment_captured`) fire — deposit
 *     row creation for `deposit_lock`, auction close for `buy_now`, etc.
 *   - Inserts a 'payment_accepted' notification for the buyer.
 *
 * reject (failed):
 *   - Flips payments.status to 'failed'.
 *   - Saves admin_notes (the reason; shown to the buyer).
 *   - Inserts a 'payment_rejected' notification linking to the receipt
 *     upload page so the buyer can re-submit with the corrected
 *     receipt.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id: paymentId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const verdict: "captured" | "failed" = body.verdict;
  const notes: string = (body.notes ?? "").trim().slice(0, 500);
  // durations is { home_featured, top_listed, banner } in days. Only honored
  // when accepting a listing_fee payment.
  const durations = (body.durations ?? {}) as Record<string, number>;
  if (verdict !== "captured" && verdict !== "failed") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (verdict === "failed" && !notes) {
    return NextResponse.json(
      { error: "reason_required", detail: "Une raison est requise pour rejeter un paiement." },
      { status: 400 },
    );
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  // Fetch the payment so we can build a meaningful notification body.
  const { data: payment } = await admin
    .from("payments")
    .select("id, user_id, kind, amount, auction_id, property_id, status")
    .eq("id", paymentId)
    .single();
  if (!payment) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }
  if (payment.status === "captured" || payment.status === "failed" || payment.status === "refunded") {
    return NextResponse.json(
      { error: "already_resolved", status: payment.status },
      { status: 409 },
    );
  }

  logAction(req, user, `payment.${verdict}`, { paymentId, kind: payment.kind, amount: payment.amount });

  // ─── Listing-fee branch: delegate to the RPC which handles the
  // property promotion + flag/duration application + notification in one
  // transaction. The buyer-side notification for accept/reject is
  // enqueued inside the RPC, so we return early.
  if (payment.kind === "listing_fee") {
    // The accept/reject RPCs guard themselves with `is_admin()`, which
    // reads auth.uid() / auth.jwt() from the caller's session. Service-
    // role has no JWT user, so calling via `admin` always fails the
    // guard. Use the authed user client instead — we already verified
    // above that this user has role='admin' on profiles, and is_admin()
    // also returns true when app_metadata.role='admin' on the JWT.
    if (verdict === "captured") {
      const sanitized: Record<string, number> = {};
      for (const k of ["home_featured", "top_listed", "banner"]) {
        const v = Number(durations?.[k] ?? 0);
        sanitized[k] = Number.isFinite(v) && v > 0 ? Math.min(365, Math.floor(v)) : 0;
      }
      const { error } = await supabase.rpc("accept_listing_payment", {
        p_payment_id: paymentId,
        p_durations: sanitized,
      });
      if (error) {
        return fail("accept_listing_payment_failed", 500, error);
      }
      return NextResponse.json({ ok: true });
    } else {
      const { error } = await supabase.rpc("reject_listing_payment", {
        p_payment_id: paymentId,
        p_reason: notes,
      });
      if (error) {
        return fail("reject_listing_payment_failed", 500, error);
      }
      return NextResponse.json({ ok: true });
    }
  }

  // Update the payment row. The `_on_payment_captured` trigger fires
  // when status flips to 'captured' and handles the auction-side
  // bookkeeping (auction_deposits row insert, close_auction_on_purchase
  // for buy_now, etc).
  // Compare-and-set: only resolve a row that is still unresolved. The early
  // already_resolved check above is a fast-fail; this closes the TOCTOU so two
  // concurrent admins (or an admin racing a user-cancel) can't both write.
  const { data: updated, error: updErr } = await admin
    .from("payments")
    .update({
      status: verdict,
      admin_notes: verdict === "failed" ? notes : null,
      reviewer_id: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .in("status", ["pending", "pending_review"])
    .select("id");
  if (updErr) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "already_resolved", detail: "Le paiement a déjà été traité." },
      { status: 409 },
    );
  }

  // Notify the buyer.
  const KIND_LABELS: Record<string, string> = {
    deposit_lock: "votre caution",
    buy_now: "votre achat",
    final_payment: "votre paiement final",
    commission: "votre commission",
    inspection_fee: "votre inspection",
    subscription: "votre abonnement",
    deposit_release: "votre remboursement",
    listing_fee: "votre annonce",
  };
  const what = KIND_LABELS[payment.kind] ?? "votre paiement";

  // Auction-tied payment → the lot; otherwise it's a listing fee paid by
  // the seller → their dashboard (the listing is now live). A captured
  // caution unlocks bidding, so drop the buyer straight on the bidding
  // page rather than the auction landing.
  const link = payment.auction_id
    ? payment.kind === "deposit_lock"
      ? `/auctions/${payment.auction_id}/bid`
      : `/auctions/${payment.auction_id}`
    : "/sell";

  if (verdict === "captured") {
    await admin.rpc("enqueue_notification", {
      p_user_id: payment.user_id,
      p_kind: "payment_accepted",
      p_title: `Reçu validé — ${what} confirmée`,
      p_body: `Votre paiement de ${Number(payment.amount).toFixed(2)} TND a été vérifié et accepté.`,
      p_link: link,
    });
  } else {
    await admin.rpc("enqueue_notification", {
      p_user_id: payment.user_id,
      p_kind: "payment_rejected",
      p_title: `Reçu refusé — ${what}`,
      p_body: `Motif : ${notes}. Vous pouvez téléverser un nouveau reçu.`,
      p_link: `/payment/checkout?payment=${paymentId}`,
    });
  }

  return NextResponse.json({ ok: true });
}
