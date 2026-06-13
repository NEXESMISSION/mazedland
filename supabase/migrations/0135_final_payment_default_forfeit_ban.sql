-- ============================================================================
-- MONEY (High, audit #3) — actually ENFORCE "pay in 14 days or forfeit + ban".
--
-- Before this, when final_payment_due_at lapsed the only thing that fired was
-- notify_final_payment_due() (reminders + an overdue alert). Nothing forfeited
-- the winner's caution or stopped them bidding again — a defaulter kept their
-- deposit locked-but-not-forfeited and could immediately re-enter other lots and
-- default again. _release_deposits_on_close (0072) already EXCLUDES the winner's
-- deposit "or separately forfeited if they walk" — this is that missing piece.
--
-- Adds:
--   * profiles.banned_at / banned_reason  (no ban mechanism existed at all)
--   * auctions.final_payment_defaulted_at (process-once marker)
--   * process_final_payment_defaults()    (cron, every 5 min): forfeit the
--     winner's caution + ban the winner for awarded lots past the deadline that
--     have NO final payment in flight.
--   * BEFORE INSERT ban triggers on bids + auction_deposits so a banned account
--     cannot place a bid or pay a new caution — enforced for EVERY path (place_bid,
--     buy-now, manual) without surgery on the place_bid fast path.
-- Idempotent; safe on a fresh DB.
-- ============================================================================

-- 1. Schema -----------------------------------------------------------------
alter table public.profiles  add column if not exists banned_at     timestamptz;
alter table public.profiles  add column if not exists banned_reason text;
alter table public.auctions  add column if not exists final_payment_defaulted_at timestamptz;

-- 2. Ban enforcement --------------------------------------------------------
create or replace function public._is_banned(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and banned_at is not null
  );
$$;

create or replace function public._reject_banned_bid()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._is_banned(new.bidder_id) then
    raise exception 'account_banned' using hint = 'This account is suspended.';
  end if;
  return new;
end; $$;

create or replace function public._reject_banned_deposit()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._is_banned(new.user_id) then
    raise exception 'account_banned' using hint = 'This account is suspended.';
  end if;
  return new;
end; $$;

drop trigger if exists reject_banned_bid on public.bids;
create trigger reject_banned_bid
  before insert on public.bids
  for each row execute function public._reject_banned_bid();

drop trigger if exists reject_banned_deposit on public.auction_deposits;
create trigger reject_banned_deposit
  before insert on public.auction_deposits
  for each row execute function public._reject_banned_deposit();

-- 3. Forfeit + ban on default ----------------------------------------------
create or replace function public.process_final_payment_defaults()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a     record;
  v_now   timestamptz := now();
  v_count int := 0;
begin
  for v_a in
    select a.id, a.winner_user_id
      from public.auctions a
     where a.status = 'awarded'
       and a.winner_user_id is not null
       and a.final_payment_due_at is not null
       and a.final_payment_due_at <= v_now
       and a.final_payment_defaulted_at is null
       -- never forfeit a winner who has a final payment in flight or done
       -- (pending/submitted/verified). Only true non-payers are caught.
       and not exists (
         select 1 from public.payments p
          where p.auction_id = a.id
            and p.kind = 'final_payment'
            and p.status not in ('rejected', 'refunded')
       )
  loop
    -- Forfeit the winner's caution (skip if already released/forfeited).
    update public.auction_deposits
       set forfeited_at = v_now
     where auction_id = v_a.id
       and user_id    = v_a.winner_user_id
       and released_at  is null
       and forfeited_at is null;

    -- Ban the winner (keep the earliest ban + reason if already set).
    update public.profiles
       set banned_at     = coalesce(banned_at, v_now),
           banned_reason = coalesce(banned_reason, 'final_payment_default')
     where id = v_a.winner_user_id;

    -- Process-once marker.
    update public.auctions set final_payment_defaulted_at = v_now where id = v_a.id;

    perform public.enqueue_notification(
      v_a.winner_user_id,
      'final_payment_defaulted',
      'Caution perdue — compte suspendu',
      'Le délai de paiement final est dépassé. Votre caution est définitivement perdue '
        || 'et votre compte est suspendu. Contactez le support pour toute question.',
      '/auctions/' || v_a.id::text
    );

    v_count := v_count + 1;
  end loop;

  return json_build_object('defaulted', v_count, 'at', v_now);
end;
$$;

revoke all on function public.process_final_payment_defaults() from public, anon, authenticated;

-- 4. Schedule every 5 minutes (idempotent). ---------------------------------
do $$
begin
  perform cron.unschedule('process_final_payment_defaults')
   where exists (select 1 from cron.job where jobname = 'process_final_payment_defaults');
end $$;
select cron.schedule(
  'process_final_payment_defaults',
  '*/5 * * * *',
  $cron$ select public.process_final_payment_defaults(); $cron$
);

notify pgrst, 'reload schema';
