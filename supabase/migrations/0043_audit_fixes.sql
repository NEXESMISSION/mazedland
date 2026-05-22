-- ============================================================================
-- Batta.tn — post-audit correctness fixes.
--
-- 1. app_settings_public_read: add the live monetization keys so end-users
--    (sellers/bidders) actually read the admin-configured fees/deposit. The
--    old policy only allowlisted the retired *_tnd keys, so every non-admin
--    silently fell back to DEFAULT_MONETIZATION — defeating the whole
--    parametrable system.
-- 2. seller_earnings: count the winner's captured deposit toward gross, so a
--    sold auction's gross = winner_amount even though the final payment is
--    now netted by the deposit (see checkout change). Keeps the ledger whole.
-- 3. _on_payment_captured: stop swallowing close_auction_on_purchase errors —
--    fail loud so a captured-but-unclosed sale can't go unnoticed.
-- 4. request_payout: per-seller advisory lock to close the concurrent
--    double-request race.
-- 5. place_bid: block self-pumping (current top bidder re-bidding, english)
--    and a second sealed bid by the same user.
-- 6. place_sixth_offer: SECURITY DEFINER RPC enforcing KYC + active deposit +
--    1/6 + deadline server-side; direct INSERT on sixth_offers is revoked so
--    the gates can't be bypassed by calling PostgREST directly.
-- ============================================================================

-- ─── 1. Public-read monetization keys ───────────────────────────────────────
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select
  using (
    key in (
      -- retired keys (kept so any legacy reader still resolves)
      'listing_fee_tnd',
      'listing_fee_offer_tnd',
      'promo_home_featured_tnd',
      'promo_top_listed_tnd',
      'promo_banner_tnd',
      -- live monetization keys (0040) — non-secret, shown to users
      'fee_listing_auction',
      'fee_listing_direct',
      'promo_home',
      'promo_top',
      'promo_banner',
      'deposit'
    )
  );

-- ─── 2. seller_earnings includes the winner's captured deposit ──────────────
create or replace function public.seller_earnings(p_seller_id uuid)
returns table (
  payment_id    uuid,
  paid_at       timestamptz,
  auction_id    uuid,
  property_id   uuid,
  property_title text,
  kind          text,
  gross_amount  numeric,
  commission    numeric,
  net_amount    numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if auth.uid() <> p_seller_id and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      pay.id,
      pay.created_at,
      pay.auction_id,
      p.id,
      p.title,
      pay.kind::text,
      pay.amount,
      pay.amount * public.batta_commission_rate(),
      pay.amount * (1 - public.batta_commission_rate())
    from public.payments pay
    join public.auctions a on a.id = pay.auction_id
    join public.properties p on p.id = a.property_id
    where pay.status = 'captured'
      and p.owner_id = p_seller_id
      and (
        pay.kind in ('buy_now', 'final_payment')
        -- The winner's deposit is "part of the purchase": the final payment
        -- is charged net of it, so count the deposit here to keep gross =
        -- winner_amount. Loser deposits are flipped to 'refunded' on refund,
        -- so status='captured' already excludes them.
        or (
          pay.kind = 'deposit_lock'
          and a.winner_user_id = pay.user_id
          and a.status in ('ended_sold', 'awarded')
        )
      )
    order by pay.created_at desc;
end;
$$;

grant execute on function public.seller_earnings(uuid) to authenticated;

-- ─── 3. _on_payment_captured: fail loud on close failure ────────────────────
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

    -- Buy-now or final payment — close the auction atomically. The RPC is
    -- idempotent on already-closed auctions (returns a no-op, doesn't raise),
    -- so a re-capture is harmless. We DO let real errors propagate: a failure
    -- here rolls back the capture, so an unclosed sale never sits silently
    -- behind a 'captured' payment.
    if new.kind in ('buy_now', 'final_payment') and new.auction_id is not null then
      perform public.close_auction_on_purchase(
        new.auction_id, new.user_id, new.amount
      );
    end if;
  end if;

  return new;
end;
$$;

-- ─── 4. request_payout: per-seller advisory lock ────────────────────────────
create or replace function public.request_payout(
  p_amount numeric,
  p_iban   text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_balance   json;
  v_available numeric;
  v_payout_id uuid;
begin
  if v_user is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  -- Serialize concurrent payout requests for the same seller so two requests
  -- can't both pass the available-balance check and over-draw.
  perform pg_advisory_xact_lock(hashtext('payout:' || v_user::text));

  v_balance := public.seller_balance(v_user);
  v_available := (v_balance ->> 'available')::numeric;

  if v_available < p_amount then
    raise exception 'insufficient_balance'
      using errcode = 'P0001',
            detail  = format('available: %s, requested: %s', v_available, p_amount);
  end if;

  insert into public.seller_payouts (seller_id, amount, iban, status)
  values (v_user, p_amount, p_iban, 'requested')
  returning id into v_payout_id;

  return json_build_object('ok', true, 'payout_id', v_payout_id);
end;
$$;

grant execute on function public.request_payout(numeric, text) to authenticated;

-- ─── 5. place_bid: self-pump + sealed single-bid guards ─────────────────────
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

  if v_auction.type = 'english' then
    if v_auction.current_price is null then
      if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    else
      v_min_next := v_auction.current_price + public.bid_increment(v_auction.current_price);
      if p_amount < v_min_next then raise exception 'below_min_increment'; end if;
    end if;

    select bidder_id, amount into v_prev_high, v_prev_amount
      from public.bids
     where auction_id = p_auction_id
     order by amount desc, placed_at asc
     limit 1;

    -- Self-pump guard: the current top bidder can't bid against themselves.
    if v_prev_high = v_user then raise exception 'already_highest'; end if;

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

  -- No self "bid placed" notification: the bidder gets immediate UI
  -- feedback, so a push every time they bid is just noise.

  -- Outbid alert to the PREVIOUS top bidder — but only if they're not
  -- currently watching this auction. If they pinged auction_presence in the
  -- last 45s they see the price move live, so the notification is redundant.
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
      'outbid',
      'Vous avez été surenchéri',
      'Une nouvelle offre de ' || to_char(p_amount, 'FM999G999G990D00') || ' TND a été placée sur ' ||
        coalesce('« ' || v_prop_title || ' »', 'cette enchère') || '. Réagissez avant la fin.',
      v_link
    );
  end if;

  -- Seller real-time bid alert (English only — sealed stays blind).
  if v_auction.type = 'english'
     and v_seller_id is not null
     and v_seller_id <> v_user then
    perform public.enqueue_notification(
      v_seller_id,
      'seller_received_bid',
      'Nouvelle offre sur votre bien',
      'Une offre de ' || to_char(p_amount, 'FM999G999G990D00') || ' TND vient d''être placée sur ' ||
        coalesce('« ' || v_prop_title || ' »', 'votre annonce') || '.',
      v_link
    );
  end if;

  perform public.enqueue_notification(
    w.user_id,
    'watched_new_bid',
    'Nouvelle offre sur un bien suivi',
    coalesce('« ' || v_prop_title || ' »', 'Une enchère suivie') || ' vient de recevoir une nouvelle offre.',
    v_link
  )
  from public.watchlist w
  where w.auction_id = p_auction_id
    and w.user_id <> v_user
    and (v_seller_id is null or w.user_id <> v_seller_id);

  if v_auction.type = 'dutch' then
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
    'current_price', case when v_auction.type = 'sealed' then null else p_amount end,
    'extended', v_extend
  );
end;
$$;

-- ─── 6. place_sixth_offer: server-side gates + revoke direct insert ──────────
create or replace function public.place_sixth_offer(
  p_auction_id uuid,
  p_amount     numeric
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_kyc     kyc_status;
  v_min     numeric;
  v_id      uuid;
begin
  if v_user is null then raise exception 'auth'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found'; end if;
  if v_auction.status <> 'sixth_offer_window' then raise exception 'window_closed'; end if;
  if v_auction.sixth_offer_deadline is null
     or v_auction.sixth_offer_deadline <= now() then
    raise exception 'window_closed';
  end if;

  select kyc_status into v_kyc from public.profiles where id = v_user;
  if v_kyc is distinct from 'verified' then raise exception 'kyc_required'; end if;

  if not exists (
    select 1 from public.auction_deposits
     where auction_id = p_auction_id and user_id = v_user
       and released_at is null and forfeited_at is null
  ) then raise exception 'deposit_required'; end if;

  v_min := ceil(v_auction.winner_amount * 7.0 / 6.0);
  if p_amount < v_min then raise exception 'below_min_sixth'; end if;

  insert into public.sixth_offers (auction_id, bidder_id, amount)
  values (p_auction_id, v_user, p_amount)
  returning id into v_id;

  return json_build_object('ok', true, 'offer_id', v_id);
end;
$$;

grant execute on function public.place_sixth_offer(uuid, numeric) to authenticated;

-- Direct inserts are no longer allowed — the RPC is the only path, so the
-- KYC/deposit gates can't be skipped by hitting PostgREST directly.
revoke insert on public.sixth_offers from authenticated;

-- ─── 7. auction_presence — "is this user looking at the auction right now" ───
-- A lightweight heartbeat the auction page upserts every ~25s. place_bid uses
-- it to skip the outbid notification for someone who's actively watching.
create table if not exists public.auction_presence (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (user_id, auction_id)
);

alter table public.auction_presence enable row level security;

drop policy if exists auction_presence_self on public.auction_presence;
create policy auction_presence_self on public.auction_presence
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.auction_presence to authenticated;

notify pgrst, 'reload schema';
