import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

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

  const { data, error } = await supabase.rpc("place_bid", {
    p_auction_id: auctionId,
    p_amount: amount,
    p_max_amount: maxAmount,
    p_ip: ip,
  });

  if (error) {
    // Map the SQL-side `raise exception 'foo'` text into HTTP statuses.
    const msg = error.message ?? "";
    const code =
      msg.includes("auth") ? 401 :
      msg.includes("auction_not_found") ? 404 :
      msg.includes("auction_closed") || msg.includes("auction_expired") ? 409 :
      msg.includes("kyc_required") ? 403 :
      msg.includes("deposit_required") ? 402 :
      msg.includes("self_bid_forbidden") ? 403 :
      msg.includes("bid_too_fast") ? 429 :
      msg.includes("dutch_price_drifted") ? 409 :
      400;
    return NextResponse.json({ error: msg }, { status: code });
  }

  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
