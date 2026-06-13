-- ============================================================================
-- MONEY (audit #10 + #11) — two settlement-path fixes.
--
-- #10: close_auction_on_purchase accepted 'scheduled' (pre-live) lots in its
--      auction-type guard, wider than the buy-now route. A buy-now capture
--      could close a lot BEFORE bidding ever opened — denying it to all bidders
--      and robbing the seller of price discovery. Tighten to live/extending.
--
-- #11: reverse_settlement flips a captured buy_now/final_payment to 'refunded'
--      but never released the buyer's caution. The refund "prepare" queue keys
--      off auction_deposits.released_at, which stayed null for the winner, so
--      the buyer's deposit was stranded (owed but never surfaced) after an admin
--      unwound a sale. Release it as part of the reversal.
--
-- Both functions are re-created verbatim from 0085 / 0114 with only the targeted
-- change. Grants persist across CREATE OR REPLACE; re-asserted for clarity.
-- ============================================================================

-- ── #10: buy-now may not close a pre-live auction ──────────────────────────
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
    -- Buy-now may only close a LIVE lot — NOT a pre-live 'scheduled' one
    -- (audit #10). 'scheduled' removed from the allowed set.
    if v_auction.status not in ('live', 'extending') then
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

revoke all on function public.close_auction_on_purchase(uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.close_auction_on_purchase(uuid, uuid, numeric)
  to service_role;

-- ── #11: reverse_settlement releases the buyer's stranded caution ──────────
create or replace function public.reverse_settlement(
  p_payment_id uuid,
  p_reason     text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay      public.payments%rowtype;
  v_seller   uuid;
  v_net      numeric := 0;
  v_paid     numeric := 0;
  v_clawback numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_pay.kind not in ('buy_now', 'final_payment') then
    raise exception 'not_a_settlement';
  end if;
  if v_pay.status <> 'captured' then raise exception 'not_captured'; end if;

  -- Resolve the seller FIRST, then serialize the whole reversal + clawback
  -- recompute against concurrent payouts for that seller.
  select pr.owner_id into v_seller
    from public.auctions a
    join public.properties pr on pr.id = a.property_id
   where a.id = v_pay.auction_id;
  if v_seller is not null then
    perform pg_advisory_xact_lock(hashtext('payout:' || v_seller::text));
  end if;

  update public.payments
     set status = 'refunded',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'reversed_by', auth.uid(),
           'reversed_at', now(),
           'reverse_reason', p_reason
         )
   where id = p_payment_id;

  -- Release the buyer's caution: the sale is unwound, so their deposit must
  -- re-enter the refund queue (which keys off released_at) instead of staying
  -- locked forever (audit #11). Release, NOT forfeit — the buyer paid in good
  -- faith and is being refunded.
  update public.auction_deposits
     set released_at = now()
   where auction_id = v_pay.auction_id
     and user_id    = v_pay.user_id
     and released_at  is null
     and forfeited_at is null;

  if v_seller is not null then
    select coalesce(sum(net_amount), 0) into v_net from public.seller_earnings(v_seller);
    select coalesce(sum(amount), 0) into v_paid
      from public.seller_payouts where seller_id = v_seller and status = 'paid';
    v_clawback := greatest(0, v_paid - v_net);
    if v_clawback > 0 then
      begin
        perform public._notify_admins(
          'admin_clawback_owed',
          'Récupération de fonds requise',
          'Un règlement encaissé a été annulé après un versement au vendeur. ' ||
            'Clawback dû : ' || to_char(v_clawback, 'FM999G999G990D00') ||
            ' TND. Récupérez le trop-perçu auprès du vendeur.',
          '/admin/payouts'
        );
      exception when others then
        raise warning 'reverse_settlement: clawback alert failed for %: %', p_payment_id, sqlerrm;
      end;
    end if;
  end if;

  return json_build_object('ok', true, 'payment_id', p_payment_id, 'clawback_owed', v_clawback);
end;
$$;
revoke all on function public.reverse_settlement(uuid, text) from public;
grant execute on function public.reverse_settlement(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
