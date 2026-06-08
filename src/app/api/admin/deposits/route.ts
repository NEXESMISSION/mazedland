import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * POST /api/admin/deposits — admin-only deposit lifecycle actions.
 * Body: { action, ... }
 *   - prepare  { auctionId } → flag every non-winner active deposit on an
 *               ended auction as "À rembourser" (released_at = now).
 *   - refund   { depositId, ref } → record the manual bank refund + notify
 *               the bidder. Must already be released.
 *   - forfeit  { depositId } → mark forfeited (e.g. winner who didn't pay).
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = body.action as string | undefined;

  // ── Prepare refunds for an ended auction ──────────────────────────────
  if (action === "prepare") {
    const auctionId = body.auctionId as string | undefined;
    if (!auctionId) return NextResponse.json({ error: "auctionId_required" }, { status: 400 });

    const { data: auc } = await admin
      .from("auctions").select("id, status, winner_user_id").eq("id", auctionId).single();
    if (!auc) return NextResponse.json({ error: "auction_not_found" }, { status: 404 });
    if (!["ended_sold", "ended_unsold", "awarded", "cancelled"].includes(auc.status as string)) {
      return NextResponse.json({ error: "auction_not_ended" }, { status: 409 });
    }

    // Release every still-locked deposit except the winner's (the winner's
    // applies to the sale; an admin can forfeit it later if they default).
    let q = admin
      .from("auction_deposits")
      .update({ released_at: new Date().toISOString() })
      .eq("auction_id", auctionId)
      .is("released_at", null)
      .is("forfeited_at", null);
    if (auc.winner_user_id) q = q.neq("user_id", auc.winner_user_id as string);
    const { data: released, error } = await q.select("id");
    if (error) return fail("deposit_prepare_failed", 500, error);
    logAction(req, user, "deposit.prepare", { auctionId, released: released?.length ?? 0 });
    return NextResponse.json({ ok: true, released: released?.length ?? 0 });
  }

  // ── Mark a deposit refunded ───────────────────────────────────────────
  if (action === "refund") {
    const depositId = body.depositId as string | undefined;
    const ref = typeof body.ref === "string" ? body.ref.trim().slice(0, 120) : null;
    if (!depositId) return NextResponse.json({ error: "depositId_required" }, { status: 400 });

    const { data: dep } = await admin
      .from("auction_deposits")
      .select("id, user_id, auction_id, amount, released_at, refunded_at, forfeited_at")
      .eq("id", depositId).single();
    if (!dep) return NextResponse.json({ error: "deposit_not_found" }, { status: 404 });
    if (dep.refunded_at) return NextResponse.json({ error: "already_refunded" }, { status: 409 });
    if (dep.forfeited_at) return NextResponse.json({ error: "forfeited" }, { status: 409 });

    // Don't refund the WINNER's caution on a settled sale. The winner's
    // deposit is part of the purchase price — it's netted out of their final
    // payment AND counted in the seller's earnings. Refunding it here would
    // silently under-pay the seller. (Use forfeit, or unwind the sale first.)
    {
      const { data: auc } = await admin
        .from("auctions")
        .select("status, winner_user_id")
        .eq("id", dep.auction_id)
        .maybeSingle();
      if (
        auc &&
        auc.winner_user_id === dep.user_id &&
        (auc.status === "ended_sold" || auc.status === "awarded")
      ) {
        return NextResponse.json({ error: "winner_caution_locked" }, { status: 409 });
      }
    }

    // Atomic guard: only the FIRST concurrent refund wins. `.is('refunded_at',
    // null)` makes the UPDATE itself the lock — two admins/tabs hitting this at
    // once can't both refund (and double-notify) the same caution.
    const { data: updatedDep, error } = await admin
      .from("auction_deposits")
      .update({
        refunded_at: new Date().toISOString(),
        refund_ref: ref,
        refunded_by: user.id,
        // ensure released so it leaves the queue cleanly
        released_at: dep.released_at ?? new Date().toISOString(),
      })
      .eq("id", depositId)
      .is("refunded_at", null)
      .select("id");
    if (error) return NextResponse.json({ error: "refund_failed" }, { status: 500 });
    if (!updatedDep || updatedDep.length === 0) {
      // Lost the race — another request already refunded it. Don't re-notify.
      return NextResponse.json({ error: "already_refunded" }, { status: 409 });
    }

    // Reflect the refund on the corresponding deposit-lock payment so the
    // user's /account/payments shows "Remboursé" instead of "Payé". Free
    // entries have no payment row → this simply matches nothing.
    // We .select("id") so we can pin the bell notification's focus to
    // exactly that row on the user's history page.
    const { data: refunded } = await admin
      .from("payments")
      .update({ status: "refunded" })
      .eq("user_id", dep.user_id)
      .eq("auction_id", dep.auction_id)
      .eq("kind", "deposit_lock")
      .in("status", ["captured", "authorized"])
      .select("id")
      .limit(1);
    const focusId = refunded?.[0]?.id as string | undefined;

    await admin.rpc("enqueue_notification", {
      p_user_id: dep.user_id,
      p_kind: "deposit_refunded",
      p_title: "Caution remboursée",
      p_body: `Votre caution de ${Number(dep.amount).toFixed(0)} TND a été remboursée${ref ? ` (réf. ${ref})` : ""}.`,
      p_link: "/account/payments",
      p_payload: focusId ? { focus: focusId } : {},
    });
    logAction(req, user, "deposit.refund", { depositId, amount: dep.amount, ref });
    return NextResponse.json({ ok: true });
  }

  // ── Forfeit a deposit ─────────────────────────────────────────────────
  if (action === "forfeit") {
    const depositId = body.depositId as string | undefined;
    if (!depositId) return NextResponse.json({ error: "depositId_required" }, { status: 400 });
    const { error } = await admin
      .from("auction_deposits")
      .update({ forfeited_at: new Date().toISOString() })
      .eq("id", depositId)
      .is("forfeited_at", null)
      .is("refunded_at", null);
    if (error) return fail("deposit_forfeit_failed", 500, error);
    logAction(req, user, "deposit.forfeit", { depositId });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
