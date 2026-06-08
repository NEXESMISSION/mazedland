-- ============================================================================
-- PAYMENTS (High) — fix the buy-now deposit double-charge in SQL (B4).
--
-- The prior "fix" lived only in checkout/page.tsx, which netted the buyer's
-- locked deposit off the buy-now price for DISPLAY but:
--   * the buy-now ROUTE still created the pending row at the FULL price, and
--     checkout reuses that row → buyer charged full price + deposit kept
--     (the original double-charge), and
--   * when a netted row WAS created, _on_payment_captured calls this RPC with
--     new.amount = (price − deposit); the old validation here required
--     abs(amount − buy_now_price) ≤ 0.5 → it RAISED amount_mismatch, the
--     trigger swallowed it, and the auction never closed despite money
--     captured. Worse than the bug it tried to fix.
--
-- Correct model (mirrors the working final_payment netting): the winner's
-- locked caution is "part of the purchase", so the buy-now payment charges
-- (price − deposit) and the deposit STAYS locked. Total consideration =
-- amount_paid + deposit_kept = price. seller_earnings (0073) already sums
-- buy_now(net) + deposit_lock(kept) = price, so the ledger is correct.
--
-- This migration changes ONLY the amount validation for the auction-with-
-- buy-now branch: it now verifies (p_amount + buyer's active deposit) ≈
-- buy_now_price. When the buyer has no deposit (incl. all DIRECT sales) the
-- term is 0 and it reduces to the old full-price check, so nothing else
-- changes. The buyer's own deposit is still kept (the losing-deposit release
-- below already excludes user_id = p_buyer_id). Everything else is verbatim
-- from 0019. Idempotent (create or replace).
--
-- The companion app change (api/auctions/[id]/buy-now/route.ts) nets the
-- deposit at row-creation time so the charged amount equals the displayed one
-- regardless of entry path.
-- ============================================================================

create or replace function public.close_auction_on_purchase(
  p_auction_id uuid,
  p_buyer_id   uuid,
  p_amount     numeric
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction       public.auctions%rowtype;
  v_owner         uuid;
  v_now           timestamptz := now();
  v_buyer_deposit numeric;
begin
  -- Lock the auction row so two concurrent buy-now attempts serialize.
  select * into v_auction
    from public.auctions
   where id = p_auction_id
   for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: if the auction has already closed (e.g. duplicate webhook, or
  -- a final_payment capture on an already-awarded auction), no-op.
  if v_auction.status in ('ended_sold', 'ended_unsold', 'awarded', 'cancelled') then
    return json_build_object(
      'ok', false,
      'reason', 'already_closed',
      'status', v_auction.status::text
    );
  end if;

  -- Buyer's active (still-locked) deposit on this auction — it counts toward
  -- the purchase price, so the buy-now payment only had to cover the balance.
  select coalesce(sum(amount), 0) into v_buyer_deposit
    from public.auction_deposits
   where auction_id = p_auction_id
     and user_id    = p_buyer_id
     and released_at is null
     and forfeited_at is null;

  -- Amount validation per listing type (0.5 TND tolerance for rounding across
  -- client display / gateway / numeric(14,2)).
  if v_auction.listing_type = 'direct' then
    -- Direct sales have no deposit; v_buyer_deposit is 0 here.
    if v_auction.sale_price is null
       or abs((p_amount + v_buyer_deposit) - v_auction.sale_price) > 0.5 then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
  else
    -- Auction-type with buy-now. Verify TOTAL consideration (paid + locked
    -- deposit) equals the price — accepts both the netted charge and, when
    -- there is no deposit, the full price.
    if v_auction.buy_now_price is null
       or abs((p_amount + v_buyer_deposit) - v_auction.buy_now_price) > 0.5 then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
    if v_auction.status not in ('live', 'extending', 'scheduled') then
      raise exception 'auction_not_open' using errcode = 'P0001';
    end if;
  end if;

  -- Self-purchase guard (defense in depth — route checks too).
  select owner_id into v_owner
    from public.properties
   where id = v_auction.property_id;
  if v_owner = p_buyer_id then
    raise exception 'self_purchase_forbidden' using errcode = 'P0001';
  end if;

  -- Audit bid — the winning row. Record the TOTAL price (paid + deposit), so
  -- bid history / admin queues show the real hammer price, not the net charge.
  insert into public.bids (auction_id, bidder_id, amount, is_proxy, is_winning)
  values (p_auction_id, p_buyer_id, p_amount + v_buyer_deposit, false, true);

  -- Close the auction at the full price.
  update public.auctions
     set status         = 'ended_sold',
         winner_user_id = p_buyer_id,
         winner_amount  = p_amount + v_buyer_deposit,
         hammer_at      = v_now,
         current_price  = p_amount + v_buyer_deposit,
         updated_at     = v_now
   where id = p_auction_id;

  -- Release all LOSING deposits. The buyer's own deposit (if any) stays
  -- unreleased — it's part of the purchase. Refund jobs key off released_at.
  update public.auction_deposits
     set released_at = v_now
   where auction_id = p_auction_id
     and user_id    <> p_buyer_id
     and released_at is null
     and forfeited_at is null;

  return json_build_object(
    'ok', true,
    'auction_id', p_auction_id,
    'buyer_id',  p_buyer_id,
    'amount',    p_amount,
    'price',     p_amount + v_buyer_deposit,
    'hammer_at', v_now
  );
end;
$$;

grant execute on function public.close_auction_on_purchase(uuid, uuid, numeric)
  to authenticated, service_role;

notify pgrst, 'reload schema';
