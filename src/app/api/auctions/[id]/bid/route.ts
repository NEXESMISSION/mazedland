import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";

/**
 * Place a bid on an auction. All validation, state mutation, and race
 * protection live in the `public.place_bid` SECURITY DEFINER RPC — this
 * route is a thin wrapper that captures the client IP and translates
 * the function's named-exception codes into HTTP responses.
 *
 * See supabase/migrations/0006_security_lockdown.sql for the auth/KYC/
 * deposit/amount/owner/race rules enforced inside `place_bid`.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id: auctionId } = await ctx.params;
  const supabase = await getServerSupabase();

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  const maxAmount = body.max_amount == null ? null : Number(body.max_amount);
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // The per-IP abuse cap lives INSIDE place_bid since 0125 (checked before
  // the FOR UPDATE lock) — one PostgREST round trip per bid instead of two.
  const { data, error } = await supabase.rpc("place_bid", {
    p_auction_id: auctionId,
    p_amount: amount,
    p_max_amount: maxAmount,
    p_ip: ip,
  });

  if (error) {
    // Map the SQL-side `raise exception 'foo'` text into a stable client code
    // + HTTP status. The raw Postgres/PostgREST message is never echoed back —
    // only the known named exception (recognised by substring) becomes a safe
    // code; anything else is redacted to a generic `bid_failed`. The real cause
    // is logged server-side by fail().
    const msg = error.message ?? "";
    // Order matters: match the most specific substrings first. Every named
    // place_bid exception maps to a stable client code so the UI can show the
    // real reason (below the min increment, below opening, etc.) instead of a
    // generic "bid_failed" — the prior mapping dropped most of them.
    const known: [string, number] | null =
      msg.includes("auction_not_found") ? ["auction_not_found", 404] :
      msg.includes("auction_closed") ? ["auction_closed", 409] :
      msg.includes("auction_expired") ? ["auction_expired", 409] :
      msg.includes("kyc_required") ? ["kyc_required", 403] :
      msg.includes("deposit_required") ? ["deposit_required", 402] :
      msg.includes("self_bid_forbidden") ? ["self_bid_forbidden", 403] :
      msg.includes("bid_too_fast") ? ["bid_too_fast", 429] :
      msg.includes("rate_limited") ? ["rate_limited", 429] :
      msg.includes("below_min_increment") ? ["below_min_increment", 409] :
      msg.includes("below_opening") ? ["below_opening", 409] :
      msg.includes("below_current") ? ["below_current", 409] :
      msg.includes("sealed_one_bid") ? ["sealed_one_bid", 409] :
      msg.includes("dutch_price_drifted") ? ["dutch_price_drifted", 409] :
      msg.includes("dutch_reserve_not_met") ? ["dutch_reserve_not_met", 409] :
      msg.includes("invalid_amount") ? ["invalid_amount", 400] :
      // Keep the broad `auth` match LAST so it can't shadow a code that happens
      // to contain the substring.
      msg.includes("auth") ? ["auth", 401] :
      null;
    return fail(known ? known[0] : "bid_failed", known ? known[1] : 400, error);
  }

  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
