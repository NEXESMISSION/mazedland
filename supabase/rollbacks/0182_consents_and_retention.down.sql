-- Rollback of 0182 · the consents table goes (with every answer recorded in
-- it), the retention jobs go back to the periods written in SQL, as they were
-- on 2026-10-27. Take `node scripts/backup-db.mjs` first.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-prune-traces') then
    perform cron.unschedule('mazed-prune-traces');
  end if;
end $$;

drop function if exists public.prune_traces();

create or replace function public.prune_activity_log()
returns void
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  update public.activity_log
     set ip = null, user_agent = null, referer = null
   where created_at < now() - interval '30 days'
     and (ip is not null or user_agent is not null or referer is not null);

  update public.activity_log al
     set user_email = null
   where al.user_email is not null
     and (
       al.user_id is null
       or exists (
         select 1 from auth.users u
          where u.id = al.user_id
            and (u.email is null or u.email like '%@deleted.invalid')
       )
     );

  delete from public.activity_log
   where (type = 'page_view' and created_at < now() - interval '90 days')
      or (created_at < now() - interval '365 days');

  -- Daily job → generous 100000s (~27.7h) budget covers a 24h cadence + slack.
  select public.stamp_cron_heartbeat('prune_activity_log', 100000);
$function$;

create or replace function public.cleanup_old_notifications()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  delete from public.notifications
   where read_at is not null
     and created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.prune_read_notifications()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
begin
  delete from public.notifications
    where read_at is not null
      and read_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

drop function if exists public.setting_days(text, int);

drop trigger if exists user_consents_no_update on public.user_consents;
drop function if exists public._user_consents_no_update();
drop table if exists public.user_consents;

notify pgrst, 'reload schema';
