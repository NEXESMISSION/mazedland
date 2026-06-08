-- ============================================================================
-- SECURITY fix-forward — 0107 revoked list_cron_jobs() from `authenticated`,
-- but Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- `authenticated` inherits it via PUBLIC — so the revoke from `authenticated`
-- alone left it callable (caught live by exploit probe B10). Revoke from PUBLIC
-- (and anon/authenticated explicitly) and re-grant ONLY service_role.
-- ============================================================================

revoke all on function public.list_cron_jobs() from public, anon, authenticated;
grant execute on function public.list_cron_jobs() to service_role;

notify pgrst, 'reload schema';
