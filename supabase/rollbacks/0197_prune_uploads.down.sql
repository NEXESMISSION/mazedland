-- Rollback of 0197 · the nightly sweep of abandoned uploads stops. The
-- objects it already removed do not come back; from here on the buckets grow
-- again by every upload nobody finished, as before.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'prune_uploads_http') then
    perform cron.unschedule('prune_uploads_http');
  end if;
end $$;
