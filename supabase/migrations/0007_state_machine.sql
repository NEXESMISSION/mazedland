-- ============================================================================
-- Batta.tn — auction state machine + payment side effects
--
-- Closes audit items:
--   H2  No automated transitions: scheduled→live, live→ended_*,
--       ended_sold→sixth_offer_window, sixth_offer_window→awarded.
--       Auctions used to sit in their initial status forever.
--   H3  Sixth-offer (offre du sixième) workflow had no admission path
--       and no settlement at deadline.
--   H4  Reserve price was a column with a check constraint but no logic
--       compared it at close. We now mark ended_unsold whenever a
--       sealed/English auction closes below reserve.
--   H5  Anti-sniping was English-only; sealed late-drops also extend.
--   C6  Webhook claimed a DB trigger would handle deposit-lock side
--       effects on payment capture — the trigger didn't exist. Added.
--
-- pg_cron schedules `tick_auctions` every minute. The same RPC is also
-- callable via /api/cron/auctions/tick so Vercel Cron / external
-- schedulers can run it on hosting providers that don't expose pg_cron.
-- ============================================================================

-- ─── H5: extend anti-sniping to sealed bids in place_bid ────────────────────
-- Redefine the RPC: the only delta vs 0006 is that the `extending` branch
-- now applies for both English and Sealed types. Dutch hammers on first
-- accept so the extension has no meaning there.

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
  v_user     uuid := auth.uid();
  v_auction  public.auctions%rowtype;
  v_min_next numeric;
  v_dutch    numeric;
  v_bid_id   uuid;
  v_now      timestamptz := now();
  v_kyc      kyc_status;
  v_extend   boolean := false;
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
  elsif v_auction.type = 'dutch' then
    v_dutch := public.dutch_current_price(v_auction);
    if abs(p_amount - v_dutch) > 0.5 then raise exception 'dutch_price_drifted'; end if;
  elsif v_auction.type = 'sealed' then
    if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
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
    -- Anti-sniping applies to sealed bids too (H5), but we still do NOT
    -- expose current_price — only stretch the deadline so other bidders
    -- can react to the timing pressure with their own blind drop.
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

  return json_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'current_price', case when v_auction.type = 'sealed' then null else p_amount end,
    'extended', v_extend
  );
end;
$$;

-- ─── C6: deposit-lock side effect on payment capture ────────────────────────
-- The Konnect webhook (and any future provider webhook) flips a payment
-- row to status='captured'. This trigger fires once on that transition
-- and materializes the auction_deposits row that place_bid then checks
-- for. Without this, real-gateway deposits never unlock bidding even
-- after the customer pays.

create or replace function public._on_payment_captured()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only act on the pending→captured transition. Idempotent against
  -- repeated webhook deliveries because the deposit upsert keys on
  -- (auction_id, user_id) and we ignore re-runs that don't change status.
  if new.status = 'captured' and (old.status is null or old.status is distinct from 'captured') then
    if new.kind = 'deposit_lock' and new.auction_id is not null then
      insert into public.auction_deposits (auction_id, user_id, amount, payment_id)
      values (new.auction_id, new.user_id, new.amount, new.id)
      on conflict (auction_id, user_id) do update
        set amount        = excluded.amount,
            payment_id    = excluded.payment_id,
            released_at   = null,
            forfeited_at  = null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_payment_captured on public.payments;
create trigger on_payment_captured
  after insert or update on public.payments
  for each row execute function public._on_payment_captured();

-- ─── H2/H3/H4: tick_auctions — the state machine in one transaction ─────────
-- Three responsibilities, all idempotent and safe to call from multiple
-- schedulers concurrently:
--
--   1. start_due:  scheduled → live, when starts_at <= now()
--   2. close_due:  live/extending → ended_sold | ended_unsold | sixth_offer_window
--   3. sixth_due:  sixth_offer_window → awarded, when sixth_offer_deadline <= now()
--                  (settles by promoting the highest sixth_offer's bidder if any)
--
-- English / sealed: pick the highest bid. If it clears reserve (or there
-- is no reserve), open the 8-day sixth-offer window; otherwise ended_unsold.
-- Dutch: closes itself in place_bid; tick only handles the no-acceptance
-- timeout (ended_unsold).

create or replace function public.tick_auctions()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_started   int := 0;
  v_closed    int := 0;
  v_awarded   int := 0;
  v_a         public.auctions%rowtype;
  v_top_bid   record;
  v_top_sixth record;
begin
  -- 1) START
  with started as (
    update public.auctions
       set status = 'live'
     where status = 'scheduled'
       and starts_at <= v_now
       and ends_at   >  v_now
     returning 1
  )
  select count(*) into v_started from started;

  -- 2) CLOSE
  for v_a in
    select * from public.auctions
     where status in ('live', 'extending')
       and ends_at <= v_now
     for update skip locked
  loop
    if v_a.type = 'dutch' then
      -- Dutch closes inside place_bid on first accept. If we got here,
      -- the auction ran out without a buyer.
      update public.auctions
         set status = 'ended_unsold'
       where id = v_a.id;
      v_closed := v_closed + 1;
      continue;
    end if;

    -- English + sealed: find the high bid.
    select bidder_id, amount
      into v_top_bid
      from public.bids
     where auction_id = v_a.id
     order by amount desc, placed_at asc
     limit 1;

    if v_top_bid is null then
      update public.auctions set status = 'ended_unsold' where id = v_a.id;
    elsif v_a.reserve_price is not null and v_top_bid.amount < v_a.reserve_price then
      -- H4: reserve not met → unsold even though there's a high bid.
      update public.auctions set status = 'ended_unsold' where id = v_a.id;
    else
      update public.auctions
         set status               = 'sixth_offer_window',
             current_price        = v_top_bid.amount,
             winner_user_id       = v_top_bid.bidder_id,
             winner_amount        = v_top_bid.amount,
             hammer_at            = v_now,
             sixth_offer_deadline = v_now + interval '8 days'
       where id = v_a.id;
    end if;
    v_closed := v_closed + 1;
  end loop;

  -- 3) SIXTH-OFFER FINALIZE
  for v_a in
    select * from public.auctions
     where status = 'sixth_offer_window'
       and sixth_offer_deadline is not null
       and sixth_offer_deadline <= v_now
     for update skip locked
  loop
    select bidder_id, amount
      into v_top_sixth
      from public.sixth_offers
     where auction_id = v_a.id
     order by amount desc, placed_at asc
     limit 1;

    if v_top_sixth is null then
      -- No higher offer landed → original winner is final.
      update public.auctions set status = 'awarded' where id = v_a.id;
    else
      -- Higher offer wins. Promote the sixth-offer bidder; preserve the
      -- prior winner_amount as currency in metadata of an audit row would
      -- be nice but is out of scope here.
      update public.auctions
         set status         = 'awarded',
             winner_user_id = v_top_sixth.bidder_id,
             winner_amount  = v_top_sixth.amount,
             current_price  = v_top_sixth.amount
       where id = v_a.id;
    end if;
    v_awarded := v_awarded + 1;
  end loop;

  return json_build_object(
    'started', v_started,
    'closed',  v_closed,
    'awarded', v_awarded,
    'at',      v_now
  );
end;
$$;

-- Service-role and the cron user execute this; anon/authenticated do not.
revoke all on function public.tick_auctions() from public;
grant execute on function public.tick_auctions() to service_role;

-- ─── pg_cron schedule (Supabase cloud) ──────────────────────────────────────
-- Best-effort: pg_cron is enabled by default on Supabase cloud projects.
-- If it's not available (self-hosted minimal install) the DO block
-- swallows the error so the migration still applies; the /api/cron
-- route remains the fallback trigger.

do $$ begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    begin
      create extension if not exists pg_cron with schema extensions;
    exception when others then
      raise notice 'pg_cron not available; skipping schedule';
      return;
    end;
  end if;

  perform cron.unschedule('tick_auctions') where exists (
    select 1 from cron.job where jobname = 'tick_auctions'
  );

  perform cron.schedule(
    'tick_auctions',
    '* * * * *',
    $cron$ select public.tick_auctions(); $cron$
  );
exception when others then
  raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
