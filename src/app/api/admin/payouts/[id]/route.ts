import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { handleClaim } from "@/lib/admin/claim";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Admin endpoint to advance a payout through its lifecycle.
 *
 *   requested  → processing  (admin acknowledged, initiating bank transfer)
 *   processing → paid        (transfer confirmed)
 *   requested  → rejected    (admin declined; seller can resubmit)
 *
 * The is_admin() RLS policy on seller_payouts handles authorization; we
 * still re-check role here so the response is a proper 403 instead of
 * an empty update silently failing.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));

  // Claim / release (assigned-to-me) — returns early when handled.
  const claimResp = await handleClaim(supabase, "seller_payouts", id, user.id, body.action);
  if (claimResp) return claimResp;

  const status = body.status as "processing" | "paid" | "rejected" | undefined;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;
  if (!status || !["processing", "paid", "rejected"].includes(status)) {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  // Atomic, per-seller-serialized transition. The RPC takes an advisory lock
  // on the seller, asserts a valid prior status, and (for 'paid') rechecks the
  // payable balance UNDER the lock — so two admins/tabs can't both mark
  // payouts paid off a stale balance and over-pay the seller. See migration
  // 0059_admin_set_payout_status.sql. Runs on the user client so auth.uid()
  // is the admin and is_admin() resolves true.
  const { data: result, error: rpcErr } = await supabase.rpc("admin_set_payout_status", {
    p_payout_id: id,
    p_status: status,
    p_notes: notes,
  });
  if (rpcErr) {
    // Preserve the safe-code → HTTP-status mapping, but never echo the raw
    // Postgres/RAISE text to the client. Each known RAISE maps to a stable
    // client code; the real message is logged server-side by fail().
    const msg = rpcErr.message || "";
    const [clientCode, status] =
      msg.includes("balance_insufficient") ? ["balance_insufficient", 409] as const
      : msg.includes("payout_terminal") ? ["payout_terminal", 409] as const
      : msg.includes("payout_not_found") ? ["payout_not_found", 404] as const
      : msg.includes("forbidden") ? ["forbidden", 403] as const
      : ["payout_update_failed", 500] as const;
    return fail(clientCode, status, rpcErr);
  }
  const payout = result as {
    seller_id: string;
    amount: number;
    iban: string | null;
    prev_status: string;
  } | null;

  if (payout?.seller_id) {
    const admin = getServiceSupabase();
    if (admin) {
      const amountFmt = Number(payout.amount).toFixed(2);
      const ibanTail = typeof payout.iban === "string" && payout.iban.length >= 4
        ? `••${payout.iban.slice(-4)}`
        : null;
      if (status === "processing") {
        await admin.rpc("enqueue_notification", {
          p_user_id: payout.seller_id,
          p_kind: "payout_processing",
          p_title: "Versement en cours",
          p_body: `Votre demande de versement de ${amountFmt} TND est en cours de traitement.`,
          p_link: "/sell#payouts",
        });
      } else if (status === "paid") {
        await admin.rpc("enqueue_notification", {
          p_user_id: payout.seller_id,
          p_kind: "payout_paid",
          p_title: "Versement effectué",
          p_body: `Votre versement de ${amountFmt} TND a été envoyé${ibanTail ? ` (IBAN ${ibanTail})` : ""}.`,
          p_link: "/sell#payouts",
        });
      } else if (status === "rejected") {
        await admin.rpc("enqueue_notification", {
          p_user_id: payout.seller_id,
          p_kind: "payout_rejected",
          p_title: "Versement refusé",
          p_body: notes
            ? `Motif : ${notes}. Vous pouvez soumettre une nouvelle demande.`
            : `Votre demande de versement de ${amountFmt} TND a été refusée.`,
          p_link: "/sell#payouts",
        });
      }
    }
  }

  logAction(req, user, `payout.${status}`, { payoutId: id, amount: payout?.amount });
  return NextResponse.json({ ok: true });
}
