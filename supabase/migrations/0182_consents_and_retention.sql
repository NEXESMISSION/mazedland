-- ============================================================================
-- 0182 · Consents, and how long personal traces are kept
--
-- Cahier, chapter 8 (loi organique 2004-63, INPDP): separate consents, kept
-- with the version of the text they answer, and a retention period for each
-- kind of personal trace.
--
-- 1. user_consents — one row per answer: accepted (or withdrawn) what, which
--    version, when, from where. The latest row of a kind is the person's
--    current answer. Rows are never edited. « Supprimer mon compte » deletes
--    them (POST /api/account/delete) and they go with a profile that is
--    removed (on delete cascade). Written by the server only; a person reads
--    their own.
--
-- 2. The retention jobs read their periods from /admin/settings → Données
--    personnelles instead of numbers written in SQL. Defaults are what the
--    jobs did until now (src/lib/settings/registry.ts holds the same ones):
--      privacy_anonymize_days   30  — IP, browser and referer cleared
--      privacy_page_views_days  90  — page views deleted
--      privacy_activity_days   365  — the rest of the activity log deleted
--      privacy_notifications_days 30 — read notifications deleted
--      privacy_traces_days     365  — listing views and number reveals deleted
--    0 keeps that trace forever (anonymizing cannot be switched off).
--    Payments, invoices and the admin audit trail are never touched here.
-- Idempotent.
-- ============================================================================

-- ─── 1. Consents ────────────────────────────────────────────────────────────

create table if not exists public.user_consents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z_]{2,30}$'),
  granted    boolean not null,
  version    text not null check (char_length(version) between 1 and 40),
  source     text not null check (source ~ '^[a-z_]{2,30}$'),
  created_at timestamptz not null default now()
);

create index if not exists user_consents_user_idx on public.user_consents (user_id, kind, created_at desc);

alter table public.user_consents enable row level security;
revoke all on table public.user_consents from anon, authenticated;
grant select on table public.user_consents to authenticated;
grant select, insert, delete on table public.user_consents to service_role;

drop policy if exists user_consents_own_read on public.user_consents;
create policy user_consents_own_read on public.user_consents
  for select to authenticated using (user_id = auth.uid() or public.admin_can('vendeurs'));

-- An answer is a fact with a date: a change of mind is a new row.
create or replace function public._user_consents_no_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'user_consents rows are not edited: record a new answer';
end;
$$;

drop trigger if exists user_consents_no_update on public.user_consents;
create trigger user_consents_no_update
  before update on public.user_consents
  for each row execute function public._user_consents_no_update();

-- ─── 2. Retention periods from the console ──────────────────────────────────

-- A whole number of days from app_settings, or the fallback when unset or odd.
create or replace function public.setting_days(p_key text, p_fallback int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
              when jsonb_typeof(value) = 'number' and (value::text)::numeric between 0 and 100000
                then floor((value::text)::numeric)::int
              when jsonb_typeof(value) = 'string' and (value #>> '{}') ~ '^[0-9]{1,5}$'
                then (value #>> '{}')::int
            end
       from public.app_settings where key = p_key),
    p_fallback
  );
$$;

revoke execute on function public.setting_days(text, int) from public, anon, authenticated;
grant execute on function public.setting_days(text, int) to service_role;

create or replace function public.prune_activity_log()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_anon  int := greatest(1, public.setting_days('privacy_anonymize_days', 30));
  v_views int := public.setting_days('privacy_page_views_days', 90);
  v_all   int := public.setting_days('privacy_activity_days', 365);
begin
  update public.activity_log
     set ip = null, user_agent = null, referer = null
   where created_at < now() - make_interval(days => v_anon)
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

  if v_views > 0 then
    delete from public.activity_log
     where type = 'page_view' and created_at < now() - make_interval(days => v_views);
  end if;
  if v_all > 0 then
    delete from public.activity_log where created_at < now() - make_interval(days => v_all);
  end if;

  -- Daily job → generous 100000s (~27.7h) budget covers a 24h cadence + slack.
  perform public.stamp_cron_heartbeat('prune_activity_log', 100000);
end;
$$;

create or replace function public.prune_read_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days  int := public.setting_days('privacy_notifications_days', 30);
  v_count integer := 0;
begin
  if v_days = 0 then return 0; end if;
  delete from public.notifications
   where read_at is not null
     and read_at < now() - make_interval(days => v_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The older job of the same kind follows the same period, so the two never
-- disagree (it used to delete read ones at 90 days, after this one's 30).
create or replace function public.cleanup_old_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.prune_read_notifications();
end;
$$;

-- Listing views (who saw which annonce) and phone-number reveals: analytics and
-- anti-abuse, not records. The counters on the annonces stay as they are.
create or replace function public.prune_traces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days  int := public.setting_days('privacy_traces_days', 365);
  v_views int := 0;
  v_rev   int := 0;
begin
  if v_days = 0 then return 0; end if;
  delete from public.listing_views where last_seen_at < now() - make_interval(days => v_days);
  get diagnostics v_views = row_count;
  delete from public.contact_reveals where created_at < now() - make_interval(days => v_days);
  get diagnostics v_rev = row_count;
  return v_views + v_rev;
end;
$$;

revoke execute on function public.prune_traces() from public, anon, authenticated;
grant execute on function public.prune_traces() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-prune-traces') then
    perform cron.unschedule('mazed-prune-traces');
  end if;
  perform cron.schedule('mazed-prune-traces', '41 3 * * *', 'select public.prune_traces();');
end $$;

notify pgrst, 'reload schema';
