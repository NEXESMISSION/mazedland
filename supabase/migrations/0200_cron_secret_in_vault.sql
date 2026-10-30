-- ============================================================================
-- 0200 · The cron secret goes into the Vault — from where it already sits.
--
-- 0158 wanted the shared secret of the cron routes out of the job URLs and
-- into a Vault secret named cron_secret, sent as a header. The secret was
-- never created, so 0158 did nothing and said so in a notice nobody read
-- (the QA tour, 2026-10-30): the key stayed in cron.job.command and in
-- every request log of three routes. The production deployment's key is
-- the one those jobs carry; this copies it into the Vault without anyone
-- typing it, so 0158 (re-applied after this) and 0197 can send it as a
-- header. Nothing is printed.
--
-- Rollback: supabase/rollbacks/0200_cron_secret_in_vault.down.sql — only
-- after the jobs are back on the URL form (0158's rollback), or they send an
-- empty header.
-- ============================================================================

do $$
declare
  v_cmd text;
  v_key text;
begin
  if exists (select 1 from vault.secrets where name = 'cron_secret') then
    raise notice '0200: the Vault already holds cron_secret — nothing to do.';
    return;
  end if;
  select command into v_cmd from cron.job where jobname = 'notify_sms_http';
  v_key := substring(v_cmd from 'key=([A-Za-z0-9_.~-]+)');
  if v_key is null or length(v_key) < 16 then
    raise exception '0200: no ?key= found in notify_sms_http — create the Vault secret by hand, see the top of 0158';
  end if;
  perform vault.create_secret(v_key, 'cron_secret', 'CRON_SECRET of the production deployment, copied from the job URL (0200, 2026-10-30)');
end $$;
