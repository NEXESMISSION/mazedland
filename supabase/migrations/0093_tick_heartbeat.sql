-- ============================================================================
-- OBSERVABILITY — make /api/health see the auction state machine, not just the
-- bid drain.
--
-- 0092 added cron_heartbeat + /api/health, but only process_bid_events stamped
-- it. So a stalled tick_auctions (auctions never close / award / release
-- deposits — the highest-impact failure) showed "healthy". Fix: a thin
-- tick_auctions_cron() wrapper that runs the (unchanged) tick_auctions() then
-- stamps the 'tick_auctions' heartbeat, and repoint the pg_cron job + the HTTP
-- backstop route to call the wrapper. Now /api/health (which already iterates
-- all heartbeat rows) covers BOTH jobs.
-- ============================================================================

create or replace function public.tick_auctions_cron()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tick json;
begin
  v_tick := public.tick_auctions();
  insert into public.cron_heartbeat (job, last_run)
  values ('tick_auctions', now())
  on conflict (job) do update set last_run = excluded.last_run;
  return v_tick;
end;
$$;

revoke all on function public.tick_auctions_cron() from public;
grant execute on function public.tick_auctions_cron() to service_role;

-- Repoint the every-minute pg_cron job to the wrapper so the heartbeat is
-- stamped on the PRIMARY (in-DB) schedule, not only when the HTTP backstop runs.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'tick_auctions') then
    perform cron.unschedule('tick_auctions');
  end if;
end $$;
select cron.schedule(
  'tick_auctions',
  '* * * * *',
  $cron$ select public.tick_auctions_cron(); $cron$
);

notify pgrst, 'reload schema';
