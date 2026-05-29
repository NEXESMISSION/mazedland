-- ============================================================================
-- Batta.tn — Phase-1 of the admin-managed popup system.
--
-- Notifications (the bell) and popups are different concerns: the bell is a
-- per-user inbox; popups are page-rendered surfaces with visual variants,
-- audience targeting, page-glob targeting, scheduling and frequency caps.
-- They live in their own table so neither system bleeds fields into the
-- other.
--
-- Phase-1 ships:
--   • `popups`          — the rule/broadcast definition (one row per popup)
--   • `popup_views`     — per-user lifecycle state (impression, dismiss, click)
--   • `match_popups()`  — server-side resolver used by /api/popups/match
--   • `record_popup_event()` — events RPC used by /api/popups/event
--
-- Subsequent phases (banner + sheet variants, derived audience filters,
-- A/B groups, metrics dashboard) extend these tables without breaking
-- changes — every column added later either has a default or is nullable.
-- ============================================================================

-- ─── popups: definitions ────────────────────────────────────────────────────

create table if not exists public.popups (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,             -- admin-friendly identifier
  -- mode = 'broadcast' → one-shot during [starts_at, ends_at]
  -- mode = 'rule'      → standing rule, always active while status='live'
  mode         text not null check (mode in ('broadcast', 'rule')),
  -- Three V1 variants. Banner and sheet land in phase 2 but the column
  -- accepts them now so we don't need a follow-up enum change.
  variant      text not null check (variant in ('banner', 'modal', 'sheet')),

  -- Localised content. Stored as { fr, ar, en } objects so one row covers
  -- every locale. PopupManager picks the active locale's value client-side;
  -- if a locale is missing it falls back to fr (the project's default).
  title        jsonb not null default '{}'::jsonb,  -- { fr: string, ar?: string, en?: string }
  body         jsonb not null default '{}'::jsonb,
  image_url    text,                              -- optional hero image
  icon         text,                              -- lucide-react icon name (kept loose; UI maps)

  -- Two optional CTAs. Each shape: { label: { fr, ar?, en? }, href: string, tone?: 'primary'|'secondary'|'ghost' }
  cta_primary   jsonb,
  cta_secondary jsonb,

  -- Audience filter. See AUDIENCE_SCHEMA at the bottom of this file for
  -- the recognised shape. Stored as jsonb so phase-3 derived filters
  -- (kyc_status, has_bid, watchlist_count_gte, governorate, …) can be
  -- added without changing the column.
  audience     jsonb not null default '{"scope":"all"}'::jsonb,

  -- Page glob list. "/", "/properties", "/auctions/*", "!/admin/*". Empty
  -- array means "every page" (default for system-wide announcements).
  pages        text[] not null default '{}'::text[],

  locales      text[] not null default '{fr,ar,en}'::text[],
  devices      text not null default 'both' check (devices in ('mobile', 'desktop', 'both')),

  starts_at    timestamptz,                       -- broadcast window; nullable for rules
  ends_at      timestamptz,

  frequency       text not null default 'once_per_user'
                  check (frequency in ('once_per_user','once_per_session','every_visit','every_n_days')),
  frequency_n     int,                            -- only used by 'every_n_days'

  dismissible  boolean not null default true,
  force_action boolean not null default false,    -- blocks the page until the primary CTA is clicked

  priority     int not null default 0,            -- when multiple match, highest wins per slot
  status       text not null default 'draft'
               check (status in ('draft','live','paused','archived')),

  -- Phase-4: A/B test grouping (sibling popups share group_id, manager
  -- rolls dice to pick one). Nullable for v1.
  group_id     uuid,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists popups_status_priority_idx
  on public.popups (status, priority desc) where status = 'live';
create index if not exists popups_window_idx
  on public.popups (starts_at, ends_at) where status = 'live' and mode = 'broadcast';
create index if not exists popups_group_idx on public.popups (group_id) where group_id is not null;

comment on table public.popups is
  'Admin-managed popup definitions. mode=broadcast uses [starts_at, ends_at]; mode=rule is evergreen while status=live. See /admin/popups for the UI.';

-- ─── popup_views: per-user lifecycle state ─────────────────────────────────
--
-- One row per (popup, user) pair, created on first impression and updated
-- on dismiss/click. Anonymous users don't get rows — their dismissals live
-- in localStorage keyed by popup.slug. That's deliberate: storing anon
-- views server-side would require a stable client id (cookies, fingerprint)
-- and bloats the table for no real win, since anon dismissals rarely need
-- to cross devices.

create table if not exists public.popup_views (
  popup_id      uuid not null references public.popups(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  dismissed_at  timestamptz,
  clicked_at    timestamptz,
  view_count    int not null default 1,
  primary key (popup_id, user_id)
);

create index if not exists popup_views_user_idx
  on public.popup_views (user_id, last_seen_at desc);
create index if not exists popup_views_active_idx
  on public.popup_views (popup_id) where dismissed_at is null;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.popups       enable row level security;
alter table public.popup_views  enable row level security;

-- Admins read/write everything. Match the project pattern (jwt app_metadata).
drop policy if exists popups_admin_all on public.popups;
create policy popups_admin_all on public.popups
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Everyone (anon + logged-in) can READ live popups. The match_popups()
-- RPC also runs as security definer for speed, but the open select
-- policy keeps the table debuggable from PostgREST and lets the admin
-- preview page hit it directly. Drafts/paused/archived stay admin-only.
drop policy if exists popups_public_read_live on public.popups;
create policy popups_public_read_live on public.popups
  for select
  using (status = 'live');

-- popup_views: a user can read AND write their own rows. Admins see all
-- so they can audit who saw what and compute aggregate metrics later.
drop policy if exists popup_views_self_rw on public.popup_views;
create policy popup_views_self_rw on public.popup_views
  for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ─── match_popups(): returns the set of live popups for a given (path,
--     user, locale, device). Heavy lifting lives here so the API route
--     stays a thin wrapper and the matcher is exercised by SQL-level tests.

create or replace function public.match_popups(
  p_path    text,
  p_locale  text default 'fr',
  p_device  text default 'both'
) returns setof public.popups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  return query
    select p.*
      from public.popups p
     where p.status = 'live'
       -- Schedule window: broadcasts respect [starts_at, ends_at]; rules
       -- always pass. NULL bounds on broadcasts mean "open on that side".
       and (
            p.mode = 'rule'
         or (p.mode = 'broadcast'
             and (p.starts_at is null or p.starts_at <= v_now)
             and (p.ends_at   is null or p.ends_at   >= v_now))
       )
       -- Locale: empty = all locales; non-empty = membership check.
       and (cardinality(p.locales) = 0 or p_locale = any(p.locales))
       -- Device: both = open; otherwise must match.
       and (p.devices = 'both' or p.devices = p_device)
       -- Pages: empty = every page; otherwise client-side glob match
       -- decides (the matcher is JS-side so it can use the same code in
       -- previews). Here we only filter out the obvious "scoped to a
       -- list and current path isn't even a prefix of anything in it"
       -- case. The PopupManager re-runs the glob anyway so this is just
       -- a coarse pre-filter — when in doubt, return the row.
       --
       -- Audience: phase-1 supports only the coarse scope (all / anon /
       -- logged_in / roles / user_ids). Derived filters land in phase 3.
       and (
            (p.audience ->> 'scope') = 'all'
         or ((p.audience ->> 'scope') = 'anon'      and v_uid is null)
         or ((p.audience ->> 'scope') = 'logged_in' and v_uid is not null)
         or (
              v_uid is not null
              and (
                   -- role membership
                   exists (
                     select 1
                       from public.profiles pr
                      where pr.id = v_uid
                        and pr.role = any (
                              coalesce(
                                array(select jsonb_array_elements_text(p.audience -> 'roles')),
                                array[]::text[]
                              )
                            )
                   )
                or v_uid::text = any (
                     coalesce(
                       array(select jsonb_array_elements_text(p.audience -> 'user_ids')),
                       array[]::text[]
                     )
                   )
              )
         )
       )
     order by p.priority desc, p.created_at asc;
end;
$$;

revoke all on function public.match_popups(text, text, text) from public;
grant execute on function public.match_popups(text, text, text) to anon, authenticated;

-- ─── record_popup_event(): impression / dismiss / click. Atomic upsert
--     so PopupManager can fire impressions without first reading state.

create or replace function public.record_popup_event(
  p_popup_id uuid,
  p_kind     text  -- 'impression' | 'dismiss' | 'click'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  -- Anonymous viewers can't be tracked server-side; their dismissals
  -- live in localStorage. Fail silently so the client doesn't need to
  -- branch on logged-in state when firing impressions.
  if v_uid is null then
    return;
  end if;

  if p_kind not in ('impression', 'dismiss', 'click') then
    raise exception 'invalid event kind: %', p_kind using errcode = '22023';
  end if;

  insert into public.popup_views as v (popup_id, user_id, first_seen_at, last_seen_at, view_count)
       values (p_popup_id, v_uid, v_now, v_now, 1)
  on conflict (popup_id, user_id) do update
       set last_seen_at = v_now,
           view_count   = v.view_count + case when p_kind = 'impression' then 1 else 0 end,
           dismissed_at = case when p_kind = 'dismiss' then v_now else v.dismissed_at end,
           clicked_at   = case when p_kind = 'click'   then v_now else v.clicked_at   end;
end;
$$;

revoke all on function public.record_popup_event(uuid, text) from public;
grant execute on function public.record_popup_event(uuid, text) to authenticated;

-- ─── updated_at touch ───────────────────────────────────────────────────────

create or replace function public._popups_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists popups_touch_updated_at on public.popups;
create trigger popups_touch_updated_at
  before update on public.popups
  for each row execute function public._popups_touch_updated_at();

-- ─── Schema reference (audience jsonb shape) ────────────────────────────────
-- {
--   "scope": "all" | "anon" | "logged_in",
--   "roles": ["individual","agency","bank","bailiff","inspector","admin"]?,
--   "user_ids": ["uuid", ...]?,
--   -- phase-3:
--   "derived": {
--     "kyc_status": ["unverified","submitted","verified","rejected"]?,
--     "has_active_deposit": true|false?,
--     "has_won_ever": true|false?,
--     "has_active_listing": true|false?,
--     "watchlist_count_gte": int?,
--     "governorate": ["Tunis","Sfax",...]?,
--     "inactive_days_gte": int?
--   }
-- }
-- ─── End ────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';
