-- Rollback of 0188 · the nightly pruning of cron.job_run_details stops and its
-- function goes. The run log deleted by 0188 does not come back (it held no
-- business data); from here on it grows again by every run, as before.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-prune-cron-history') then
    perform cron.unschedule('mazed-prune-cron-history');
  end if;
end $$;

drop function if exists public.prune_cron_history();

notify pgrst, 'reload schema';
