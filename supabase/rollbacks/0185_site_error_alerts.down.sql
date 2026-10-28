-- Rollback of 0185 · no more admin alerts on site errors; the errors
-- themselves stay in activity_log as before. Take `node scripts/backup-db.mjs` first.
drop trigger if exists activity_log_alert_errors on public.activity_log;
drop function if exists public._alert_site_error();
drop function if exists public.setting_bool(text, boolean);
drop table if exists public.site_error_alerts;
notify pgrst, 'reload schema';
