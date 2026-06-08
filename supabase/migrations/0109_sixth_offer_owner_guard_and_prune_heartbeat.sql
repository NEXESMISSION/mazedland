-- ============================================================================
-- AUCTION + OBSERVABILITY polish (re-benchmark).
--
-- 1) place_sixth_offer (0043) had NO property-owner self-bid guard — unlike
--    place_bid, which blocks the owner. A seller who somehow holds an active
--    deposit on their own lot could place a sixth-offer to inflate / reclaim it.
--    Add the same self_bid_forbidden gate.
--
-- 2) prune_activity_log (the GDPR PII-minimization cron, 0097) stamped no
--    heartbeat, so a stall on it (raw IP/email never scrubbed) was invisible.
--    Now /api/health supports per-job staleness budgets (0101), so add a daily
--    budget for it and stamp on every run.
-- ============================================================================

-- 1) Owner self-bid guard on the sixth-offer RPC.
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

  -- Owner can never bid on their own lot (parity with place_bid 0091).
  if exists (
    select 1 from public.properties p
     where p.id = v_auction.property_id and p.owner_id = v_user
  ) then raise exception 'self_bid_forbidden'; end if;

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

-- 2) prune_activity_log + heartbeat (verbatim 0097 body + a final stamp).
create or replace function public.prune_activity_log()
returns void
language sql
security definer
set search_path = public, auth
as $$
  update public.activity_log
     set ip = null, user_agent = null, referer = null
   where created_at < now() - interval '30 days'
     and (ip is not null or user_agent is not null or referer is not null);

  update public.activity_log al
     set user_email = null
   where al.user_email is not null
     and (
       al.user_id is null
       or exists (
         select 1 from auth.users u
          where u.id = al.user_id
            and (u.email is null or u.email like '%@deleted.invalid')
       )
     );

  delete from public.activity_log
   where (type = 'page_view' and created_at < now() - interval '90 days')
      or (created_at < now() - interval '365 days');

  -- Daily job → generous 100000s (~27.7h) budget covers a 24h cadence + slack.
  select public.stamp_cron_heartbeat('prune_activity_log', 100000);
$$;

-- Pre-register so /health tracks it from now (stamp refreshes last_run daily).
insert into public.cron_heartbeat (job, last_run, max_age_seconds)
values ('prune_activity_log', now(), 100000)
on conflict (job) do update set max_age_seconds = excluded.max_age_seconds;

notify pgrst, 'reload schema';
