-- Rollback of 0169: the AI call log and its two settings. The cost history
-- is lost; export first (node scripts/backup-db.mjs).
drop table if exists public.ai_calls;
delete from public.app_settings where key in ('ai_enabled', 'ai_daily_budget_usd');
