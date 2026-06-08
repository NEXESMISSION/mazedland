import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { isValidIban, normalizeIban } from "@/lib/iban";
import { logAction } from "@/lib/activity";
import { log } from "@/lib/log";

/**
 * Seller payout endpoint.
 *
 *   POST  → request_payout(amount, iban) RPC. The DB enforces the amount
 *           ≤ available balance check; we just translate exceptions.
 *   GET   → list the caller's own payouts (RLS handles isolation).
 *
 * Sellers can also have a request rejected; the rejection notes come
 * back in the row's reviewer_notes column and are surfaced in the UI.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  // We always store the canonical (no-space, uppercase) form. Saves the
  // admin from having to compare "FR14 2004..." against "FR142004..."
  // when reconciling a transfer.
  const ibanRaw = typeof body.iban === "string" ? body.iban : null;
  const iban = ibanRaw ? normalizeIban(ibanRaw) : null;

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }
  // IBAN is optional (rare, but the RPC handles the null case by
  // emailing the seller for one later). If supplied, it must pass
  // ISO 13616 mod-97 — a typo'd IBAN that only failed length-check
  // costs the operator a manual bank-call to fix, vs. a hard reject.
  if (iban !== null && !isValidIban(iban)) {
    return NextResponse.json({ error: "invalid_iban" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("request_payout", {
    p_amount: amount,
    p_iban: iban,
  });
  if (error) {
    // Map only the KNOWN, safe named exceptions to a stable client code.
    // Anything else is redacted to a generic error — raw Postgres/PostgREST
    // messages (and `error.details`, which can echo balance figures / column
    // names) must never reach an end user. The real cause is logged server-side
    // for the operator.
    const known =
      error.message.includes("insufficient_balance") ? "insufficient_balance"
      : error.message.includes("invalid_amount") ? "invalid_amount"
      : error.message.includes("auth") ? "auth"
      : null;
    if (!known) {
      log.scope("api").error("request_payout failed", { msg: error.message });
    }
    return NextResponse.json(
      { error: known ?? "payout_failed" },
      { status: known ? 400 : 500 },
    );
  }
  logAction(req, user, "payout.request", { amount, hasIban: iban !== null });
  return NextResponse.json(data);
}

export async function GET() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("seller_payouts")
    .select("id, amount, status, iban, payment_method, reviewer_notes, processed_at, created_at")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "payouts_failed" }, { status: 500 });
  }
  return NextResponse.json({ payouts: data ?? [] });
}
