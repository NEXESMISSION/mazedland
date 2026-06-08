-- ============================================================================
-- OBSERVABILITY — let an HTTP cron worker stamp cron_heartbeat.
--
-- In-DB pg_cron jobs stamp their own heartbeat inline (SECURITY DEFINER, so
-- table grants don't matter). The notify-email worker is an HTTP route using
-- the service_role client, which has only SELECT on cron_heartbeat (0092) — it
-- cannot upsert directly. This definer RPC is the bridge: the worker calls it on
-- every successful run so /api/health can see the email-delivery path (the sole
-- delivery channel for money-critical mail) and 503 when it stalls.
-- Idempotent.
-- ============================================================================

create or replace function public.stamp_cron_heartbeat(p_job text, p_max_age int default 300)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cron_heartbeat (job, last_run, max_age_seconds)
  values (p_job, now(), greatest(coalesce(p_max_age, 300), 30))
  on conflict (job) do update
    set last_run = excluded.last_run,
        max_age_seconds = excluded.max_age_seconds;
end;
$$;

revoke all on function public.stamp_cron_heartbeat(text, int) from public;
grant execute on function public.stamp_cron_heartbeat(text, int) to service_role;

notify pgrst, 'reload schema';
