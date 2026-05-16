-- ============================================================================
-- Batta.tn — atomic auction close on buy-now / direct-sale purchase.
--
-- When the buyer's payment captures (kind = 'buy_now' or 'final_payment'
-- with buy-now flag), we need to:
--   1. Close the auction (status='ended_sold', winner_*, hammer_at)
--   2. Insert a winning bid row for the audit trail
--   3. Release every other active deposit on the auction so the losers
--      get refunded automatically
-- All in one transaction, behind a row lock so concurrent buy-now
-- attempts on the same auction serialize cleanly.
--
-- The trigger that fires it lives in _on_payment_captured (extended
-- below).
-- ============================================================================

-- ─── 1. close_auction_on_purchase RPC ───────────────────────────────────────
-- SECURITY DEFINER so it can update auctions + auction_deposits without
-- the buyer needing direct write privileges on those tables.

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
  v_auction public.auctions%rowtype;
  v_owner   uuid;
  v_now     timestamptz := now();
begin
  -- Lock the auction row so two concurrent buy-now attempts serialize.
  select * into v_auction
    from public.auctions
   where id = p_auction_id
   for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: if the auction has already closed (e.g. duplicate webhook),
  -- return a structured no-op rather than re-running the close logic.
  if v_auction.status in ('ended_sold', 'ended_unsold', 'awarded', 'cancelled') then
    return json_build_object(
      'ok', false,
      'reason', 'already_closed',
      'status', v_auction.status::text
    );
  end if;

  -- Amount validation per listing type. We allow a 0.5 TND tolerance to
  -- absorb rounding between client display, payment gateway, and the
  -- numeric(14,2) stored value.
  if v_auction.listing_type = 'direct' then
    if v_auction.sale_price is null
       or abs(p_amount - v_auction.sale_price) > 0.5 then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
  else
    -- auction-type with buy-now
    if v_auction.buy_now_price is null
       or abs(p_amount - v_auction.buy_now_price) > 0.5 then
      raise exception 'amount_mismatch' using errcode = 'P0001';
    end if;
    -- Auction-with-buy-now must be open. Direct listings can be in any
    -- pre-close status (most likely 'scheduled' since they don't tick).
    if v_auction.status not in ('live', 'extending', 'scheduled') then
      raise exception 'auction_not_open' using errcode = 'P0001';
    end if;
  end if;

  -- Self-purchase guard. The /api/auctions/[id]/buy-now route already
  -- checks this before initiating the payment, but the trigger path
  -- could be invoked from a webhook with a stale auction state — guard
  -- here too as defense in depth.
  select owner_id into v_owner
    from public.properties
   where id = v_auction.property_id;
  if v_owner = p_buyer_id then
    raise exception 'self_purchase_forbidden' using errcode = 'P0001';
  end if;

  -- Audit bid — the winning row so /bid history and admin queues see who
  -- closed the auction. Marked is_winning=true; never proxy.
  insert into public.bids (auction_id, bidder_id, amount, is_proxy, is_winning)
  values (p_auction_id, p_buyer_id, p_amount, false, true);

  -- Close the auction.
  update public.auctions
     set status         = 'ended_sold',
         winner_user_id = p_buyer_id,
         winner_amount  = p_amount,
         hammer_at      = v_now,
         current_price  = p_amount,
         updated_at     = v_now
   where id = p_auction_id;

  -- Release all losing deposits. The buyer's own deposit (if any —
  -- direct sales don't have one) stays unreleased; the deposit becomes
  -- part of the purchase. Refund jobs key off released_at IS NOT NULL.
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
    'hammer_at', v_now
  );
end;
$$;

grant execute on function public.close_auction_on_purchase(uuid, uuid, numeric)
  to authenticated, service_role;

-- ─── 2. Extend _on_payment_captured trigger ────────────────────────────────
-- Original (0007) only handled deposit_lock → materialize auction_deposits.
-- We extend it to also handle final_payment + buy_now: call the close
-- RPC above. Re-runs are safe because the RPC is idempotent on already-
-- closed auctions.

create or replace function public._on_payment_captured()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'captured'
     and (old.status is null or old.status is distinct from 'captured') then

    -- Deposit lock — materialize the auction_deposits row.
    if new.kind = 'deposit_lock' and new.auction_id is not null then
      insert into public.auction_deposits (auction_id, user_id, amount, payment_id)
      values (new.auction_id, new.user_id, new.amount, new.id)
      on conflict (auction_id, user_id) do update
        set amount      = excluded.amount,
            payment_id  = excluded.payment_id,
            released_at = null,
            forfeited_at = null;
    end if;

    -- Buy-now or final payment via the unified purchase endpoint —
    -- close the auction in one atomic call. We don't raise on errors
    -- here because the trigger fires from the webhook context; surfacing
    -- a DB error there is just noise (the captured payment is real).
    -- The RPC itself is idempotent, so a duplicate webhook is harmless.
    if new.kind in ('buy_now', 'final_payment') and new.auction_id is not null then
      begin
        perform public.close_auction_on_purchase(
          new.auction_id, new.user_id, new.amount
        );
      exception when others then
        raise warning 'close_auction_on_purchase failed for payment %: %', new.id, sqlerrm;
      end;
    end if;
  end if;

  return new;
end;
$$;

-- Trigger declaration is unchanged from 0007 — same after-insert-or-update,
-- same function name. The CREATE OR REPLACE FUNCTION above swaps the body.

notify pgrst, 'reload schema';
