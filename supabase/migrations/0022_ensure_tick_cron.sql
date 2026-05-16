-- ============================================================================
-- Batta.tn — ensure the auction-tick pg_cron is scheduled.
--
-- Vercel Hobby caps cron jobs at once-per-day, so vercel.json can't
-- carry the minute-level auction tick. pg_cron in Supabase runs at
-- any interval, free, and inside the same network as the database.
--
-- Migration 0007 originally tried to schedule this, but wrapped the
-- pg_cron setup in a forgiving DO/exception block that silently
-- swallows failures. If pg_cron wasn't installed at 0007 push time,
-- the schedule never landed and there was no way to tell.
--
-- This migration:
--   1. Explicitly creates the pg_cron extension (idempotent).
--   2. Drops any prior `tick_auctions` schedule.
--   3. Re-installs the every-minute schedule.
--   4. Exposes a `list_cron_jobs()` SECURITY DEFINER function so we
--      can verify from PostgREST without needing dashboard access.
-- ============================================================================

-- 1. pg_cron extension (Supabase enables this in the `extensions` schema)
create extension if not exists pg_cron with schema extensions;

-- 2. Drop any prior schedule with this name. cron.unschedule errors if
--    the job doesn't exist, so guard the call.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'tick_auctions') then
    perform cron.unschedule('tick_auctions');
  end if;
end $$;

-- 3. Install the every-minute schedule.
select cron.schedule(
  'tick_auctions',
  '* * * * *',
  $cron$ select public.tick_auctions(); $cron$
);

-- 4. Helper to verify the schedule is live without dashboard access.
--    SECURITY DEFINER so the calling user doesn't need direct
--    privileges on the cron schema; returns just the safe columns.
create or replace function public.list_cron_jobs()
returns table (
  jobid    bigint,
  jobname  text,
  schedule text,
  command  text,
  active   boolean
)
language sql
security definer
set search_path = public, cron
as $$
  select jobid, jobname, schedule, command, active
  from cron.job
  order by jobid;
$$;

grant execute on function public.list_cron_jobs() to authenticated, service_role;

notify pgrst, 'reload schema';
