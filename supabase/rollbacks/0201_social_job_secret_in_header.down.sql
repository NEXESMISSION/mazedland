-- Rollback of 0201 · the social job carries the key in its URL again, read
-- from the Vault once, at rollback time. Only with code that still accepts
-- ?key= (the cron routes stopped on 2026-10-30): otherwise leave 0201 in place.

do $$
declare
  v_id  bigint;
  v_url text;
  v_key text;
begin
  select jobid, substring(command from 'url\s*:=\s*''([^'']+)''') into v_id, v_url
    from cron.job where jobname = 'social_publish_http';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_secret';
  if v_id is null or v_key is null then return; end if;
  perform cron.alter_job(v_id, command := format('select net.http_get(url:=%L, timeout_milliseconds:=60000)', v_url || '?key=' || v_key));
end $$;
