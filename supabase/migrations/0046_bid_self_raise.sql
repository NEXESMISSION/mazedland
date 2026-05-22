-- ============================================================================
-- Batta.tn — allow the current top bidder to raise their own bid.
--
-- Previously place_bid enforced two rules together:
--   1. Every new bid must be >= current_price + bid_increment.
--   2. The current top bidder can never place another bid
--      (`already_highest` exception).
--
-- For proxy-style strategies (lifting your hidden ceiling), the second
-- rule was a footgun: users with the lead but watching a competitor
-- creep up couldn't move first. The new rule:
--
--   - Non-top bidders still need >= current + increment.
--   - The current top bidder can raise their own bid as long as the
--     new amount is strictly greater than the current price. No
--     increment requirement, no self-pump block. They're not
--     competing with themselves on price; they're tightening their
--     proxy window.
--
-- Everything else in place_bid (KYC gate, deposit gate, self-listing
-- block, sealed/dutch branches, anti-snipe extension, notifications)
-- is preserved verbatim from 0043_audit_fixes.sql.
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

  -- Look up the current top bidder BEFORE we decide which rule to
  -- apply, so the english-auction branch can branch on self-raise.
  if v_auction.type = 'english' then
    select bidder_id, amount into v_prev_high, v_prev_amount
      from public.bids
     where auction_id = p_auction_id
     order by amount desc, placed_at asc
     limit 1;

    if v_auction.current_price is null then
      -- Opening bid: only constraint is >= opening_price.
      if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    elsif v_prev_high = v_user then
      -- Self-raise: the user is already on top. Drop the increment
      -- floor; they just need to move strictly above their own
      -- current bid. (The amount==current case is a no-op; reject it.)
      if p_amount <= v_auction.current_price then raise exception 'below_current'; end if;
    else
      -- Standard outbid: enforce the increment ladder.
      v_min_next := v_auction.current_price + public.bid_increment(v_auction.current_price);
      if p_amount < v_min_next then raise exception 'below_min_increment'; end if;
    end if;

  elsif v_auction.type = 'dutch' then
    v_dutch := public.dutch_current_price(v_auction);
    if abs(p_amount - v_dutch) > 0.5 then raise exception 'dutch_price_drifted'; end if;
  elsif v_auction.type = 'sealed' then
    if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    -- One hidden bid per participant.
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

  select p.title, p.owner_id into v_prop_title, v_seller_id
    from public.properties p where p.id = v_auction.property_id;
  v_link := '/auctions/' || p_auction_id::text;

  -- Outbid alert to the PREVIOUS top bidder — but only if they're not
  -- currently watching this auction AND aren't the bidder themselves
  -- (self-raise should never produce an outbid ping).
  if v_auction.type = 'english'
     and v_prev_high is not null
     and v_prev_high <> v_user
     and not exists (
       select 1 from public.auction_presence ap
        where ap.user_id = v_prev_high
          and ap.auction_id = p_auction_id
          and ap.seen_at > v_now - interval '45 seconds'
     ) then
    perform public.enqueue_notification(
      v_prev_high,
      'auction_outbid',
      'Vous avez été dépassé',
      coalesce(v_prop_title, 'votre enchère') || ' — nouvelle offre supérieure.',
      v_link
    );
  end if;

  return json_build_object('ok', true, 'bid_id', v_bid_id, 'extended', v_extend);
end;
$$;

grant execute on function public.place_bid(uuid, numeric, numeric, inet) to authenticated;

notify pgrst, 'reload schema';
