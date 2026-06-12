-- ============================================================================
-- PERF (bidding hot path) — one round trip per bid, authoritative ack.
--
-- Two latency sources made every bid feel slow:
--   1. The /api/auctions/[id]/bid route ran TWO sequential PostgREST calls —
--      check_rate_limit, await, then place_bid. The IP cap now runs INSIDE
--      place_bid (still BEFORE the FOR UPDATE row lock, so a hammering IP
--      cannot drive lock contention), halving the network round trips.
--   2. place_bid's success json had no current_price, so the composer could
--      not trust the ack and leaned on router.refresh()/realtime to learn
--      the new price. The ack now carries it: p_amount for english (the
--      accepted bid IS the new price) and dutch (hammer price); null for
--      sealed (price stays masked).
--
-- Raises 'rate_limited' (the route maps it to HTTP 429). Body is otherwise
-- VERBATIM from 0117. Idempotent (create or replace).
-- ============================================================================

create or replace function public.place_bid(
  p_auction_id uuid,
  p_amount     numeric,
  p_max_amount numeric default null,
  p_ip         inet    default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid := auth.uid();
  v_auction     public.auctions%rowtype;
  v_min_next    numeric;
  v_dutch       numeric;
  v_bid_id      uuid;
  v_now         timestamptz := now();
  v_kyc         kyc_status;
  v_extend      boolean := false;
  v_prev_high   uuid;
  v_prev_amount numeric;
  v_prop_title  text;
  v_seller_id   uuid;
  v_link        text;
  v_cooldown    interval := interval '2 seconds';
begin
  if v_user is null then raise exception 'auth'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  -- Cross-instance per-IP abuse cap (moved here from the API route in 0125 —
  -- it was a separate round trip). Checked BEFORE the FOR UPDATE lock so a
  -- hammering IP can't drive lock contention on the hot lot. 90/min is well
  -- above any legitimate bidding war.
  if public.check_rate_limit('bid:' || coalesce(host(p_ip), 'anon'), 90, 60) then
    raise exception 'rate_limited';
  end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found'; end if;
  if v_auction.status not in ('live', 'extending') then raise exception 'auction_closed'; end if;
  if v_auction.ends_at <= v_now then raise exception 'auction_expired'; end if;

  select kyc_status into v_kyc from public.profiles where id = v_user;
  if v_kyc is distinct from 'verified' then raise exception 'kyc_required'; end if;

  if not exists (
    select 1 from public.auction_deposits
     where auction_id = p_auction_id and user_id = v_user
       and released_at is null and forfeited_at is null
  ) then raise exception 'deposit_required'; end if;

  if exists (
    select 1 from public.properties p
     where p.id = v_auction.property_id and p.owner_id = v_user
  ) then raise exception 'self_bid_forbidden'; end if;

  if exists (
    select 1 from public.bids
     where auction_id = p_auction_id
       and bidder_id  = v_user
       and placed_at  > v_now - v_cooldown
  ) then raise exception 'bid_too_fast'; end if;

  if v_auction.type = 'english' then
    select bidder_id, amount into v_prev_high, v_prev_amount
      from public.bids
     where auction_id = p_auction_id
     order by amount desc, placed_at asc
     limit 1;

    if v_auction.current_price is null then
      if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    elsif v_prev_high = v_user then
      if p_amount <= v_auction.current_price then raise exception 'below_current'; end if;
    else
      v_min_next := v_auction.current_price + public.bid_increment(v_auction.current_price);
      if p_amount < v_min_next then raise exception 'below_min_increment'; end if;
    end if;

  elsif v_auction.type = 'dutch' then
    v_dutch := public.dutch_current_price(v_auction);
    if abs(p_amount - v_dutch) > 0.5 then raise exception 'dutch_price_drifted'; end if;
    -- Reserve guard: the descending price must meet the seller's reserve before
    -- a sale can hammer. Below it, no valid acceptance exists (price only falls).
    if v_auction.reserve_price is not null and v_dutch < v_auction.reserve_price then
      raise exception 'dutch_reserve_not_met';
    end if;
  elsif v_auction.type = 'sealed' then
    if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    if exists (
      select 1 from public.bids
       where auction_id = p_auction_id and bidder_id = v_user
    ) then raise exception 'sealed_one_bid'; end if;
  end if;

  -- Public row: NO ip_address/max_amount (those carry into the realtime payload).
  insert into public.bids (auction_id, bidder_id, amount, is_proxy)
  values (
    p_auction_id, v_user, p_amount,
    p_max_amount is not null and p_max_amount > p_amount
  )
  returning id into v_bid_id;

  -- Sensitive fields on the non-published sibling table (0090).
  insert into public.bid_private (bid_id, ip_address, max_amount)
  values (v_bid_id, p_ip, p_max_amount);

  v_extend := (v_auction.ends_at - v_now)
            <= make_interval(secs => v_auction.extend_window_seconds);

  if v_auction.type = 'english' then
    update public.auctions
       set current_price = p_amount,
           ends_at = case when v_extend
             then ends_at + make_interval(secs => extend_by_seconds)
             else ends_at end,
           status = case when v_extend
             then 'extending'::auction_status
             else status end
     where id = p_auction_id;
  elsif v_auction.type = 'sealed' then
    update public.auctions
       set ends_at = case when v_extend
             then ends_at + make_interval(secs => extend_by_seconds)
             else ends_at end,
           status = case when v_extend
             then 'extending'::auction_status
             else status end
     where id = p_auction_id;
  elsif v_auction.type = 'dutch' then
    update public.auctions
       set current_price  = p_amount,
           status         = 'ended_sold',
           winner_user_id = v_user,
           winner_amount  = p_amount,
           hammer_at      = v_now
     where id = p_auction_id;
  end if;

  -- ─── Notifications ─────────────────────────────────────────────────────
  v_link := '/auctions/' || p_auction_id::text;

  -- Outbid + watchlist fan-out deferred to process_bid_events (0087) via one
  -- O(1) event row, off the FOR UPDATE lock.
  insert into public.bid_events (auction_id, bidder_id, amount, prev_high_bidder, is_english)
  values (
    p_auction_id, v_user, p_amount,
    case when v_auction.type = 'english' then v_prev_high else null end,
    v_auction.type = 'english'
  );

  -- Dutch shortcut — hammer fell, bidder won + seller sold. O(1), inline.
  if v_auction.type = 'dutch' then
    select p.title, p.owner_id into v_prop_title, v_seller_id
      from public.properties p where p.id = v_auction.property_id;
    perform public.enqueue_notification(
      v_user,
      'auction_won',
      'Vous avez gagné !',
      'Votre acceptation à ' || to_char(p_amount, 'FM999G999G990D00') || ' TND a clôturé ' ||
        coalesce('« ' || v_prop_title || ' »', 'l''enchère') || '. Procédez au paiement final.',
      v_link
    );
    if v_seller_id is not null and v_seller_id <> v_user then
      perform public.enqueue_notification(
        v_seller_id,
        'auction_sold_seller',
        'Votre bien a été vendu',
        coalesce('« ' || v_prop_title || ' »', 'Votre annonce') || ' a été vendu à ' ||
          to_char(p_amount, 'FM999G999G990D00') || ' TND.',
        v_link
      );
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'extended', v_extend,
    -- Authoritative post-bid price for the ack (0125): english/dutch = the
    -- accepted amount; sealed stays null (price is masked until close).
    'current_price', case when v_auction.type = 'sealed' then null else p_amount end
  );
end;
$$;

grant execute on function public.place_bid(uuid, numeric, numeric, inet) to authenticated;

notify pgrst, 'reload schema';
