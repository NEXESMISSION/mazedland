-- ============================================================================
-- 0201 · The social publisher's job sends the secret as a header too.
--
-- 0158 moved the SMS and e-mail jobs' secret out of their URLs; 0170 made
-- the social job after it, with the key in its URL again. Now that the
-- Vault holds cron_secret (0200), the three jobs read it the same way and
-- the cron routes stop accepting a key in the query string at all.
--
-- Rollback: supabase/rollbacks/0201_social_job_secret_in_header.down.sql.
-- ============================================================================

do $$
declare
  v_id  bigint;
  v_url text;
begin
  select jobid, substring(command from 'url\s*:=\s*''([^'']+)''') into v_id, v_url
    from cron.job where jobname = 'social_publish_http';
  if v_id is null then
    raise notice '0201: social_publish_http not found — nothing to do.';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise exception '0201: vault secret cron_secret missing — apply 0200 first';
  end if;
  v_url := regexp_replace(v_url, '\?key=[^&]*(&|$)', '');
  perform cron.alter_job(
    v_id,
    command := format($cmd$select net.http_get(
      url := %L,
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    )$cmd$, v_url)
  );
end $$;
