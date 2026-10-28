-- ============================================================================
-- 0185 · Tell the admins when the site breaks
--
-- On 2026-10-28 « Publier » crashed for an agence owner from 11:38: every
-- crash was in activity_log (type 'error'), and nobody looked until the owner
-- said « ما يخدمش ». Now the first time an error shows up in production, the
-- admins get it in the console's bell: where, what, and a link to the errors.
--
-- One alert per error per period (Réglages → Limites → error_alert_hours,
-- 6 h by default): the same crash repeated by every visitor is one alert, and
-- it comes back if it is still happening after the period. An error is « the
-- same » when it happens at the same place (route, or path without its query)
-- with the same message.
--
-- Only production counts: the app tags each error with metadata.env
-- (VERCEL_ENV); local development writes to this database too.
-- Switch: Réglages → Fonctionnalités → feature_error_alerts.
-- The trigger never fails the insert of the error itself.
-- Idempotent.
-- ============================================================================

create table if not exists public.site_error_alerts (
  signature     text primary key,
  place         text not null,
  message       text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_alert_at timestamptz,
  seen          integer not null default 1
);

alter table public.site_error_alerts enable row level security;
revoke all on table public.site_error_alerts from anon, authenticated;
grant select, insert, update, delete on table public.site_error_alerts to service_role;

-- A yes/no from app_settings, or the fallback when unset or not a boolean.
create or replace function public.setting_bool(p_key text, p_fallback boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(value) = 'boolean' then (value #>> '{}')::boolean end
       from public.app_settings where key = p_key),
    p_fallback
  );
$$;

revoke execute on function public.setting_bool(text, boolean) from public, anon, authenticated;
grant execute on function public.setting_bool(text, boolean) to service_role;

create or replace function public._alert_site_error()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place text;
  v_msg   text;
  v_sig   text;
  v_hours int;
  v_last  timestamptz;
begin
  if coalesce(new.metadata ->> 'env', '') <> 'production' then return null; end if;
  if not public.setting_bool('feature_error_alerts', true) then return null; end if;

  -- setting_days reads any whole number (0182); here it is hours.
  v_hours := greatest(1, public.setting_days('error_alert_hours', 6));
  v_place := regexp_replace(
    regexp_replace(coalesce(new.metadata ->> 'route', new.path, ''), '^https?://[^/]+', ''),
    '[?#].*$', '');
  v_msg := left(coalesce(nullif(new.metadata ->> 'message', ''), new.action, 'error'), 160);
  v_sig := md5(v_place || '|' || v_msg);

  insert into public.site_error_alerts as a (signature, place, message)
  values (v_sig, left(v_place, 200), v_msg)
  on conflict (signature) do update
     set last_seen_at = now(), seen = a.seen + 1
  returning a.last_alert_at into v_last;

  if v_last is null or v_last < now() - make_interval(hours => v_hours) then
    update public.site_error_alerts set last_alert_at = now() where signature = v_sig;
    perform public._notify_admins(
      'admin_site_error',
      'Erreur sur le site',
      format('%s — « %s ». Les visiteurs voient une page d''erreur.', v_place, v_msg),
      '/admin/activity?type=error',
      jsonb_build_object('vars', jsonb_build_object('place', v_place, 'message', v_msg))
    );
  end if;
  return null;
exception when others then
  -- An alert that fails must not lose the error row it was about.
  return null;
end;
$$;

drop trigger if exists activity_log_alert_errors on public.activity_log;
create trigger activity_log_alert_errors
  after insert on public.activity_log
  for each row
  when (new.type = 'error')
  execute function public._alert_site_error();

notify pgrst, 'reload schema';
