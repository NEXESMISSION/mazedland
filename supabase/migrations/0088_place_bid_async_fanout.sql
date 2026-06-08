-- ============================================================================
-- SCALABILITY (High) — place_bid drops the O(watchers) fan-out from inside the
-- FOR UPDATE lock; it now enqueues ONE bid_events row (O(1)) that
-- process_bid_events() (0087, pg_cron) drains off the hot path.
--
-- Identical to 0077 EXCEPT the notification section: the outbid ping + the
-- watchlist INSERT…SELECT (the parts that scaled with watcher count) are
-- replaced by a single bid_events insert. The Dutch immediate win/sold pings
-- stay inline (O(1)). All gates (KYC / deposit / self-bid / cooldown /
-- increment / sealed-one-bid / dutch-drift), the bid insert, anti-snipe extend,
-- and the per-type auction UPDATE are unchanged.
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

  -- Per-user-per-auction cooldown (race-free under the auction lock).
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
  elsif v_auction.type = 'sealed' then
    if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    if exists (
      select 1 from public.bids
       where auction_id = p_auction_id and bidder_id = v_user
    ) then raise exception 'sealed_one_bid'; end if;
  end if;

  insert into public.bids (auction_id, bidder_id, amount, max_amount, is_proxy, ip_address)
  values (
    p_auction_id, v_user, p_amount, p_max_amount,
    p_max_amount is not null and p_max_amount > p_amount,
    p_ip
  )
  returning id into v_bid_id;

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

  -- Outbid + watchlist fan-out are O(watchers) and would hold the auction lock
  -- across a bulk insert on a hot lot. Defer them: drop ONE O(1) event row and
  -- let process_bid_events() (pg_cron, 0087) fan them out off the hot path.
  insert into public.bid_events (auction_id, bidder_id, amount, prev_high_bidder, is_english)
  values (
    p_auction_id, v_user, p_amount,
    case when v_auction.type = 'english' then v_prev_high else null end,
    v_auction.type = 'english'
  );

  -- Dutch shortcut — hammer fell, bidder won + seller sold. O(1), kept inline so
  -- the winner/seller are notified immediately (no watcher fan-out here).
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

  return json_build_object('ok', true, 'bid_id', v_bid_id, 'extended', v_extend);
end;
$$;

grant execute on function public.place_bid(uuid, numeric, numeric, inet) to authenticated;

notify pgrst, 'reload schema';
