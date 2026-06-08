import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";

/**
 * POST /api/admin/manual-payment — admin-only.
 *
 * Records a payment that happened OFFLINE (cash / cheque / received transfer)
 * as a captured `payments` row, so the system treats it exactly like an
 * online capture. The `on_payment_captured` trigger then fires the downstream
 * effect for the kind:
 *   - deposit_lock  → materializes auction_deposits (auction entry granted)
 *   - buy_now       → close_auction_on_purchase (buyer wins)
 *   - final_payment → close_auction_on_purchase (balance settled; idempotent)
 *
 * No migration: provider is free-text, status/kind already exist, and the
 * trigger is bound `after insert or update` so an inserted captured row fires.
 */
const KINDS = ["deposit_lock", "buy_now", "final_payment"] as const;
type Kind = (typeof KINDS)[number];
const METHODS = ["cash", "cheque", "transfer", "other"] as const;
type Method = (typeof METHODS)[number];
const BIDDABLE = ["scheduled", "live", "extending"];

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const kind = body.kind as Kind;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const auctionId = typeof body.auctionId === "string" ? body.auctionId : "";
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  const method: Method = (METHODS as readonly string[]).includes(body.method as string)
    ? (body.method as Method) : "cash";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  }
  if (!userId || !auctionId) {
    return NextResponse.json({ error: "missing_target" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "bad_amount" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  // ── Validate the target user + auction ──────────────────────────────────
  const { data: payer } = await admin
    .from("profiles").select("id, full_name, kyc_status").eq("id", userId).single();
  if (!payer) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const { data: auction } = await admin
    .from("auctions")
    .select("id, status, winner_user_id, buy_now_price, current_price, opening_price, property_id")
    .eq("id", auctionId)
    .single();
  if (!auction) return NextResponse.json({ error: "auction_not_found" }, { status: 404 });

  const status = auction.status as string;

  if (kind === "deposit_lock" || kind === "buy_now") {
    if (!BIDDABLE.includes(status)) {
      return NextResponse.json(
        { error: "auction_not_biddable", detail: `Statut « ${status} » — l'enchère n'accepte plus d'entrée.` },
        { status: 409 },
      );
    }
  }
  if (kind === "buy_now" && auction.buy_now_price == null) {
    return NextResponse.json(
      { error: "no_buy_now", detail: "Cette enchère n'a pas de prix d'achat immédiat." },
      { status: 409 },
    );
  }
  if (kind === "final_payment" && auction.winner_user_id !== userId) {
    return NextResponse.json(
      { error: "not_winner", detail: "Le paiement final ne peut être enregistré que pour le gagnant de l'enchère." },
      { status: 409 },
    );
  }

  // ── Duplicate guards ────────────────────────────────────────────────────
  if (kind === "deposit_lock") {
    const { data: existing } = await admin
      .from("auction_deposits")
      .select("id")
      .eq("auction_id", auctionId)
      .eq("user_id", userId)
      .is("released_at", null)
      .is("forfeited_at", null)
      .is("refunded_at", null)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "already_entered", detail: "Cet utilisateur a déjà une caution active sur cette enchère." },
        { status: 409 },
      );
    }
  }
  if (kind === "buy_now" || kind === "final_payment") {
    if (
      (status === "ended_sold" || status === "awarded") &&
      auction.winner_user_id &&
      auction.winner_user_id !== userId
    ) {
      return NextResponse.json(
        { error: "already_sold", detail: "Cette enchère est déjà adjugée à un autre utilisateur." },
        { status: 409 },
      );
    }
  }

  // For a buy_now where the buyer locked a deposit online, the caution is part
  // of the purchase (mirrors the online buy-now route + close_auction_on_purchase,
  // which validates amount + deposit == buy_now_price). Record the NET against the
  // authoritative buy_now_price so the trigger's close doesn't reject it
  // (amount_mismatch → captured row rolls back) and the buyer isn't double-charged.
  let insertAmount = amount;
  if (kind === "buy_now" && auction.buy_now_price != null) {
    const { data: depRows } = await admin
      .from("auction_deposits")
      .select("amount")
      .eq("auction_id", auctionId)
      .eq("user_id", userId)
      .is("released_at", null)
      .is("forfeited_at", null)
      .order("amount", { ascending: false })
      .limit(1);
    const credit = Number(depRows?.[0]?.amount ?? 0);
    if (credit > 0) {
      insertAmount = Math.max(0, Math.round((Number(auction.buy_now_price) - credit) * 100) / 100);
    }
  }

  // ── Insert the captured payment (trigger handles the rest) ───────────────
  const now = new Date().toISOString();
  const { data: created, error: insErr } = await admin
    .from("payments")
    .insert({
      user_id: userId,
      kind,
      // `payment_provider` is an enum; 'manual' is its catch-all for
      // admin-recorded offline payments. The real method (cash/cheque/…)
      // lives in metadata.method so no enum migration is needed.
      provider: "manual",
      amount: insertAmount,
      auction_id: auctionId,
      property_id: auction.property_id,
      status: "captured",
      reviewer_id: user.id,
      reviewed_at: now,
      metadata: {
        manual: true,
        method,
        note,
        entered_by: user.id,
        entered_at: now,
      },
    })
    .select("id")
    .single();
  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message ?? "insert_failed" }, { status: 500 });
  }

  // ── Notify the payer (reuse the existing accepted-payment kind) ──────────
  const KIND_LABEL: Record<Kind, string> = {
    deposit_lock: "Votre caution",
    buy_now: "Votre achat",
    final_payment: "Votre paiement final",
  };
  await admin.rpc("enqueue_notification", {
    p_user_id: userId,
    p_kind: "payment_accepted",
    p_title: `${KIND_LABEL[kind]} a été enregistrée`,
    p_body: `Un paiement de ${insertAmount.toFixed(2)} TND (${method === "cash" ? "espèces" : method}) a été enregistré par l'équipe Batta.`,
    p_link: kind === "deposit_lock" ? `/auctions/${auctionId}/bid` : `/auctions/${auctionId}`,
  });

  logAction(req, user, "payment.manual", { kind, amount: insertAmount, payerId: userId, auctionId });
  return NextResponse.json({
    ok: true,
    paymentId: created.id,
    kycWarning: kind === "deposit_lock" && payer.kyc_status !== "verified",
  });
}
