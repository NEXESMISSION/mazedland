-- ============================================================================
-- 0188 · Keep the scheduled jobs' run log short.
--
-- pg_cron writes one row in cron.job_run_details for every run, and nothing
-- ever cleared it. Three jobs that call the site every five minutes (SMS,
-- e-mail, social) had piled up 436 726 rows since May — 110 MB of a 222 MB
-- database on 2026-10-28, against about 20 MB of real data.
--
-- prune_cron_history() keeps `cron_history_days` (/admin/settings, 7 by
-- default, never less than 1) and is run every night; it also runs once here
-- for the backlog. pg_net's responses (net._http_response) need nothing: they
-- already expire after pg_net.ttl (6 hours).
--
-- Rollback: supabase/rollbacks/0188_prune_cron_history.down.sql (the deleted
-- run log does not come back; it holds no business data).
-- ============================================================================

create or replace function public.prune_cron_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(public.setting_days('cron_history_days', 7), 1), 90);
  v_n    int := 0;
begin
  delete from cron.job_run_details
   where coalesce(end_time, start_time) < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.prune_cron_history() from public, anon, authenticated;
grant execute on function public.prune_cron_history() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-prune-cron-history') then
    perform cron.unschedule('mazed-prune-cron-history');
  end if;
  perform cron.schedule('mazed-prune-cron-history', '47 3 * * *', 'select public.prune_cron_history();');
end $$;

-- The backlog, once.
select public.prune_cron_history();

notify pgrst, 'reload schema';
