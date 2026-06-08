-- ============================================================================
-- AUCTION (High + Med) — buy-now must not undercut a standing higher bid, and
-- a stale buy-now capture during the sixth-offer window must not roll back.
--
-- 0079 validated only (amount + deposit) ≈ buy_now_price; it never compared the
-- standing high bid. So on an English auction that has already climbed to
-- 230k, a buyer clicking "Acheter maintenant" at a 200k buy_now_price closed
-- the lot at 200k, displaced the legitimate 230k leader (deposit auto-released),
-- and cost the seller 30k. Also, the idempotent no-op list omitted
-- 'sixth_offer_window': a buy-now receipt captured by an admin AFTER the lot
-- naturally closed into the 8-day window fell through to
-- `raise 'auction_not_open'`, which (the trigger is fail-loud) rolled back the
-- admin's capture and stranded the payment.
--
-- This migration (otherwise identical to 0079):
--   * adds 'sixth_offer_window' to the idempotent terminal no-op set;
--   * in the auction-with-buy-now branch, if a standing bid already met/
--     exceeded buy_now_price, returns a NO-OP {ok:false, high_bid_exceeds_buynow}
--     instead of closing — so the higher bidder wins and the captured buy-now
--     payment can be refunded out-of-band (no rollback of the admin txn).
-- The buy-now ROUTE also rejects initiation once current_price >= buy_now_price
-- (separate change) so this RPC branch is only a defensive backstop.
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
  select * into v_auction
    from public.auctions
   where id = p_auction_id
   for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent no-op on any terminal/locked state. sixth_offer_window is
  -- included so a buy-now receipt captured after the lot closed naturally does
  -- not roll back the admin transaction — it degrades to a refundable no-op.
  if v_auction.status in ('ended_sold', 'ended_unsold', 'awarded', 'cancelled', 'sixth_offer_window') then
    return json_build_object(
      'ok', false,
      'reason', 'already_closed',
      'status', v_auction.status::text
    );
  end if;

  select coalesce(sum(amount), 0) into v_buyer_deposit
    from public.auction_deposits
   where auction_id = p_auction_id
     and user_id    = p_buyer_id
     and released_at is null
     and forfeited_at is null;

  if v_auction.listing_type = 'direct' then
    if v_auction.sale_price is null
       or abs((p_amount + v_buyer_deposit) - v_auction.sale_price) > 0.5 then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
  else
    if v_auction.buy_now_price is null
       or abs((p_amount + v_buyer_deposit) - v_auction.buy_now_price) > 0.5 then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
    if v_auction.status not in ('live', 'extending', 'scheduled') then
      raise exception 'auction_not_open' using errcode = 'P0001';
    end if;
    -- A standing bid already met/exceeded buy_now_price → buy-now is retired;
    -- do NOT close under the higher bidder. No-op (not raise) so the captured
    -- payment can be refunded without rolling back the admin txn.
    if v_auction.current_price is not null
       and v_auction.current_price >= v_auction.buy_now_price then
      return json_build_object(
        'ok', false,
        'reason', 'high_bid_exceeds_buynow',
        'current_price', v_auction.current_price,
        'buy_now_price', v_auction.buy_now_price
      );
    end if;
  end if;

  select owner_id into v_owner
    from public.properties
   where id = v_auction.property_id;
  if v_owner = p_buyer_id then
    raise exception 'self_purchase_forbidden' using errcode = 'P0001';
  end if;

  insert into public.bids (auction_id, bidder_id, amount, is_proxy, is_winning)
  values (p_auction_id, p_buyer_id, p_amount + v_buyer_deposit, false, true);

  update public.auctions
     set status         = 'ended_sold',
         winner_user_id = p_buyer_id,
         winner_amount  = p_amount + v_buyer_deposit,
         hammer_at      = v_now,
         current_price  = p_amount + v_buyer_deposit,
         updated_at     = v_now
   where id = p_auction_id;

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
