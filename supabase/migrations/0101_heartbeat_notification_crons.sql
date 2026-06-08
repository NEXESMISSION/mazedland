-- ============================================================================
-- OBSERVABILITY (HIGH) — make /api/health see the money-critical notification
-- crons, with PER-JOB staleness thresholds.
--
-- 0092/0093 gave heartbeat + /health coverage only to the minute-cadence jobs
-- (tick_auctions, process_bid_events). The notification reminder crons run as
-- pg_cron SQL functions but stamp NO heartbeat, so a pg_cron stall on them is
-- silent — buyers stop getting `final-payment-due` reminders and forfeit
-- deposits with nobody alerted. /health used ONE global 300s threshold, which
-- cannot cover jobs on slower cadences:
--    * notify_auctions_ending_soon   — every 10 min  (*/10)
--    * notify_final_payment_due       — hourly        (15 * * * *)
--
-- This:
--   1. Adds cron_heartbeat.max_age_seconds (per-job staleness budget).
--   2. Seeds the two minute-jobs (300s) + the two notification jobs
--      (ending-soon 1800s = 3 missed runs; final-payment-due 7200s = 2h).
--   3. Wraps each notification function in a *_cron() that runs it then stamps
--      its heartbeat (same pattern as tick_auctions_cron), and repoints the
--      pg_cron schedule to the wrapper.
-- /api/health is updated separately to compare each job against its own
-- max_age_seconds. Idempotent.
-- ============================================================================

alter table public.cron_heartbeat
  add column if not exists max_age_seconds int not null default 300;

-- Seed thresholds (and pre-register the notification jobs so /health tracks
-- them from now — a wrapper that never runs lets last_run go stale = 503).
insert into public.cron_heartbeat (job, last_run, max_age_seconds) values
  ('tick_auctions',               now(), 300),
  ('process_bid_events',          now(), 300),
  ('notify_auctions_ending_soon', now(), 1800),
  ('notify_final_payment_due',    now(), 7200)
on conflict (job) do update set max_age_seconds = excluded.max_age_seconds;

-- ── ending-soon wrapper (every 10 min) ──────────────────────────────────────
create or replace function public.notify_auctions_ending_soon_cron()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_auctions_ending_soon();
  insert into public.cron_heartbeat (job, last_run, max_age_seconds)
  values ('notify_auctions_ending_soon', now(), 1800)
  on conflict (job) do update set last_run = excluded.last_run, max_age_seconds = excluded.max_age_seconds;
end;
$$;
revoke all on function public.notify_auctions_ending_soon_cron() from public;
grant execute on function public.notify_auctions_ending_soon_cron() to service_role;

-- ── final-payment-due wrapper (hourly) ──────────────────────────────────────
create or replace function public.notify_final_payment_due_cron()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_final_payment_due();
  insert into public.cron_heartbeat (job, last_run, max_age_seconds)
  values ('notify_final_payment_due', now(), 7200)
  on conflict (job) do update set last_run = excluded.last_run, max_age_seconds = excluded.max_age_seconds;
end;
$$;
revoke all on function public.notify_final_payment_due_cron() from public;
grant execute on function public.notify_final_payment_due_cron() to service_role;

-- ── repoint pg_cron schedules to the heartbeat-stamping wrappers ─────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'batta-ending-soon') then
      perform cron.unschedule('batta-ending-soon');
    end if;
    perform cron.schedule(
      'batta-ending-soon', '*/10 * * * *',
      $cron$ select public.notify_auctions_ending_soon_cron(); $cron$
    );

    if exists (select 1 from cron.job where jobname = 'batta-final-payment-due') then
      perform cron.unschedule('batta-final-payment-due');
    end if;
    perform cron.schedule(
      'batta-final-payment-due', '15 * * * *',
      $cron$ select public.notify_final_payment_due_cron(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron reschedule skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
