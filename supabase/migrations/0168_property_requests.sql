-- ============================================================================
-- 0168 · Demandes: what a buyer or a tenant is looking for
--
-- The catalogue only works when the property is already online. A demande
-- keeps the other half: someone who wants an S+2 in Sfax under 200 000 TND, or
-- a furnished studio in Tunis from December, and is told when one appears.
-- On a site with a dozen annonces that is most visitors.
--
-- 1. property_requests — one search, kept. The budget ceiling and the other
--    minimums are hard conditions; `note` is the rest, in the person's own
--    words ("proche du centre"). Empty arrays mean "any category", "anywhere".
--    A demande lives 60 days unless renewed, so an alert nobody wants any
--    more stops on its own.
-- 2. matches — an annonce that met a demande, recorded once so its owner is
--    told once. `reasons` keeps what was checked and what could not be
--    (an annonce that does not state its furniture), for the page that will
--    show them. Phase 2 (owners seeing demandes, visits) builds on this row.
--
-- Both are written by the server only (service role, through /api/requests
-- and the publish path). A signed-in user may read their own demandes.
-- Idempotent.
-- ============================================================================

-- ── 1. property_requests ───────────────────────────────────────────────────
create table if not exists public.property_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  deal_type     text not null check (deal_type in ('sale', 'rent')),
  category_ids  uuid[] not null default '{}',
  governorates  text[] not null default '{}',
  budget_min    numeric(12,2) check (budget_min is null or budget_min >= 0),
  budget_max    numeric(12,2) check (budget_max is null or budget_max > 0),
  surface_min   numeric(10,2) check (surface_min is null or surface_min > 0),
  rooms_min     smallint check (rooms_min is null or rooms_min between 1 and 10),
  -- Rental only.
  furnished     text check (furnished is null or furnished in ('furnished', 'semi', 'unfurnished')),
  move_in_by    date,
  note          text check (note is null or char_length(note) <= 500),
  status        text not null default 'active' check (status in ('active', 'paused', 'fulfilled')),
  alerts        boolean not null default true,
  expires_at    timestamptz not null default (now() + interval '60 days'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint property_requests_budget_order
    check (budget_min is null or budget_max is null or budget_min <= budget_max),
  constraint property_requests_rent_fields_only_for_rent
    check (deal_type = 'rent' or (furnished is null and move_in_by is null))
);

create index if not exists property_requests_user_idx
  on public.property_requests (user_id, created_at desc);
create index if not exists property_requests_live_idx
  on public.property_requests (deal_type, expires_at)
  where status = 'active' and alerts;

drop trigger if exists _touch_property_requests on public.property_requests;
create trigger _touch_property_requests before update on public.property_requests
  for each row execute function public._touch_updated_at();

alter table public.property_requests enable row level security;

-- Supabase grants the client roles everything on a new table by default (see
-- 0157); take that back and give only what the policy below allows.
revoke all on table public.property_requests from anon, authenticated;
grant select on table public.property_requests to authenticated;

drop policy if exists property_requests_own_read on public.property_requests;
create policy property_requests_own_read on public.property_requests
  for select to authenticated using (user_id = auth.uid());

-- ── 2. matches ─────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.property_requests(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  score       smallint not null check (score between 0 and 100),
  reasons     jsonb not null default '{}',
  status      text not null default 'notified' check (status in ('notified', 'seen', 'dismissed', 'contacted')),
  created_at  timestamptz not null default now(),
  constraint matches_once unique (request_id, listing_id)
);

create index if not exists matches_listing_idx on public.matches (listing_id);

alter table public.matches enable row level security;
revoke all on table public.matches from anon, authenticated;
