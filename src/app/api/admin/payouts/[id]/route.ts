import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { handleClaim } from "@/lib/admin/claim";
import { logAction } from "@/lib/activity";

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
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Claim / release (assigned-to-me) — returns early when handled.
  const claimResp = await handleClaim(supabase, "seller_payouts", id, user.id, body.action);
  if (claimResp) return claimResp;

  const status = body.status as "processing" | "paid" | "rejected" | undefined;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;
  if (!status || !["processing", "paid", "rejected"].includes(status)) {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    reviewer_id: user.id,
    reviewer_notes: notes,
  };
  if (status === "paid") {
    update.processed_at = new Date().toISOString();
  }

  // Fetch the payout owner + amount so we can notify the seller.
  const { data: payout } = await supabase
    .from("seller_payouts")
    .select("id, seller_id, amount, iban")
    .eq("id", id)
    .single();

  // Re-validate the balance before paying out: the seller's net can erode
  // after the request (e.g. a sale's payment was later refunded), and the
  // request-time check is now stale. Block the payout if it exceeds what's
  // still owed (lifetime_net − already paid out).
  if (status === "paid" && payout?.seller_id) {
    const { data: bal } = await supabase.rpc("seller_balance", {
      p_seller_id: payout.seller_id,
    });
    const net = Number((bal as { lifetime_net?: number } | null)?.lifetime_net ?? 0);
    const paidOut = Number((bal as { paid_out?: number } | null)?.paid_out ?? 0);
    const payable = Math.round((net - paidOut) * 100) / 100;
    if (Number(payout.amount) > payable + 0.001) {
      return NextResponse.json(
        { error: "balance_insufficient", detail: `payable: ${payable}, payout: ${payout.amount}` },
        { status: 409 },
      );
    }
  }

  const { error } = await supabase
    .from("seller_payouts")
    .update(update)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
