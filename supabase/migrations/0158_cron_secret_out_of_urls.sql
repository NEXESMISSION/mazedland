-- ============================================================================
-- 0158 · Cron secret out of URLs
--
-- `notify_sms_http` and `notify_email_http` called
--   https://mazedland.vercel.app/api/cron/notify-{sms,email}?key=<CRON_SECRET>
-- every five minutes. A secret in a query string is written verbatim into the
-- platform's request logs, into any proxy or CDN trace, and into `cron.job`
-- itself, where anyone with read access to the scheduler sees it. The routes
-- have always accepted `Authorization: Bearer <secret>`; this switches the jobs
-- to that, and reads the secret from Supabase Vault at run time so it is no
-- longer stored in the job's command at all.
--
-- PREREQUISITE — do these first, in order:
--   1. Generate a NEW secret (the old one has been in request logs; treat it
--      as disclosed):   openssl rand -base64 32
--   2. Set it as CRON_SECRET in the Vercel project env, and redeploy.
--   3. Store the same value in Vault:
--        select vault.create_secret('<new secret>', 'cron_secret',
--                                   'Bearer token for /api/cron/* routes');
--   4. Apply this migration.
--
-- If the Vault secret is missing, this migration changes NOTHING and says so —
-- it will not leave the drains calling the API with an empty token.
-- ============================================================================

do $$
declare
  v_sms   bigint;
  v_email bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0158: vault secret "cron_secret" not found — cron jobs left unchanged. See the prerequisites at the top of this file.';
    return;
  end if;

  select jobid into v_sms   from cron.job where jobname = 'notify_sms_http';
  select jobid into v_email from cron.job where jobname = 'notify_email_http';

  if v_sms is not null then
    perform cron.alter_job(
      job_id  := v_sms,
      command := $cmd$select net.http_get(
        url := 'https://mazedland.vercel.app/api/cron/notify-sms',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        timeout_milliseconds := 30000
      )$cmd$
    );
  else
    raise notice '0158: job notify_sms_http not found, skipped';
  end if;

  if v_email is not null then
    perform cron.alter_job(
      job_id  := v_email,
      command := $cmd$select net.http_get(
        url := 'https://mazedland.vercel.app/api/cron/notify-email',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        timeout_milliseconds := 30000
      )$cmd$
    );
  else
    raise notice '0158: job notify_email_http not found, skipped';
  end if;
end
$$;
