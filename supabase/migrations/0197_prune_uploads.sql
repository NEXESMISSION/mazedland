-- ============================================================================
-- 0197 · Abandoned uploads are swept every night.
--
-- Photos go up to the public `properties` bucket while the wizard is still
-- open, and receipts to `receipts` before the payment is sent: an upload is
-- a promise that a row will follow. Nothing removed the ones whose row never
-- came, or is gone since. On 2026-10-30 (the QA tour) 61 of the 106 objects
-- of `properties` — about 20 of its 26 MB, all publicly downloadable — and 27
-- of the 36 receipts were named by no row at all.
--
-- The sweep is /api/cron/prune-uploads (the Storage API, not storage.objects,
-- so the files go with the rows): every object no row names, older than
-- `uploads_prune_days` (/admin/settings, 2 by default). Called nightly with
-- the shared secret from the Vault, like the SMS, e-mail and social drains
-- (0158, 0170). Without the secret nothing is scheduled, and this says so.
--
-- Rollback: supabase/rollbacks/0197_prune_uploads.down.sql (the sweep stops;
-- what it already removed does not come back).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0197: pg_cron missing — prune_uploads_http not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'prune_uploads_http') then
    perform cron.unschedule('prune_uploads_http');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0197: vault secret "cron_secret" not found — prune_uploads_http not scheduled. See the prerequisites at the top of 0158.';
    return;
  end if;
  perform cron.schedule('prune_uploads_http', '23 4 * * *',
    $cmd$select net.http_get(
      url := 'https://www.mazed.immo/api/cron/prune-uploads',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    )$cmd$);
end $$;
