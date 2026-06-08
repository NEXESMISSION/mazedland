-- ============================================================================
-- AUCTION ENGINE (HIGH) — rescue 'scheduled' auctions whose window elapsed.
--
-- tick_auctions() phase-1 START requires `ends_at > now`; phase-2 CLOSE
-- requires `status in (live, extending)`. So a 'scheduled' auction whose
-- entire starts_at..ends_at window passed between ticks (a cron outage that
-- spans a short window, or a very-soon short auction) is NEVER started and
-- NEVER closed — it strands indefinitely, and because deposits can be locked
-- on a 'scheduled' auction (see api/auctions/[id]/deposit allows scheduled),
-- every locked deposit on it is stranded too (the _release_deposits_on_close
-- trigger only fires on the terminal transition that never happens).
--
-- Fix WITHOUT touching the 360-line tick_auctions body or duplicating its
-- relist block: in the cron WRAPPER (one txn), flip fully-elapsed 'scheduled'
-- rows to 'live' BEFORE calling tick_auctions(). The same call's CLOSE pass
-- then sees them (live AND ends_at<=now) and runs the normal no-bid path:
-- ended_unsold + relist + the deposit-release trigger. The flip is invisible
-- externally (same transaction) and opens no biddable window — place_bid
-- rejects ends_at<=now ('auction_expired').
--
-- The wrapper is the single entry point for BOTH the pg_cron job and the HTTP
-- backstop route (0093), so both paths get the rescue. Idempotent.
-- ============================================================================

create or replace function public.tick_auctions_cron()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tick json;
  v_rescued int;
begin
  -- Rescue stranded scheduled auctions whose window already elapsed. They
  -- never accepted a bid (place_bid needs live/extending), so routing them
  -- through CLOSE finalizes them as ended_unsold and refunds locked deposits.
  update public.auctions
     set status = 'live'
   where status = 'scheduled'
     and ends_at <= now();
  get diagnostics v_rescued = row_count;
  if v_rescued > 0 then
    raise warning 'tick_auctions_cron: rescued % stranded scheduled auction(s) into close path', v_rescued;
  end if;

  v_tick := public.tick_auctions();

  insert into public.cron_heartbeat (job, last_run)
  values ('tick_auctions', now())
  on conflict (job) do update set last_run = excluded.last_run;

  return v_tick;
end;
$$;

revoke all on function public.tick_auctions_cron() from public;
grant execute on function public.tick_auctions_cron() to service_role;

notify pgrst, 'reload schema';
