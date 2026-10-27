-- ============================================================================
-- 0179 · Projects and their units (Mazed Immo Pro, cahier P2)
--
-- A promoter sells a residence, a lotissement or a commercial building before
-- it is finished, unit by unit. A project belongs to an agence; its units are
-- the apartments, villas, lots, shops… with their reference (A-101, Lot 7),
-- surface, price and status — available, reserved, sold — which the agence
-- changes as it sells.
--
-- The agence manages them from its dashboard (« Projets ») and a published
-- project has a public page under the agence's. Like shops (0173), these
-- tables are read and written by the server with the service role, after the
-- API route checked the caller's role in the agence; nothing here is open to
-- the client roles. Units are not annonces: they take no place in a plan.
-- Idempotent.
-- ============================================================================

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  slug         text not null
                 check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  name         text not null check (char_length(name) between 2 and 100),
  kind         text not null check (kind in ('residence', 'villas', 'lotissement', 'commercial', 'mixed')),
  description  text check (description is null or char_length(description) <= 3000),
  governorate  text not null,
  -- The délégation, canonical (src/lib/delegations.ts), and a quartier.
  delegation   text check (delegation is null or char_length(delegation) <= 80),
  address      text check (address is null or char_length(address) <= 200),
  -- « delivered », or the quarter it is due: 2027-Q2.
  delivery     text check (delivery is null or delivery = 'delivered' or delivery ~ '^20[2-9][0-9]-Q[1-4]$'),
  cover_path   text check (cover_path is null or char_length(cover_path) <= 300),
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint projects_slug_once unique (shop_id, slug)
);

create index if not exists projects_shop_idx on public.projects (shop_id, status, created_at desc);

create table if not exists public.project_units (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  ref         text not null check (char_length(ref) between 1 and 20),
  kind        text not null check (kind in ('apartment', 'duplex', 'villa', 'land', 'shop', 'office', 'parking')),
  block       text check (block is null or char_length(block) <= 20),
  floor       smallint check (floor is null or floor between 0 and 60),
  rooms       smallint check (rooms is null or rooms between 0 and 20),
  area_sqm    numeric(10, 2) check (area_sqm is null or (area_sqm > 0 and area_sqm <= 100000)),
  price       numeric(14, 3) check (price is null or price > 0),
  status      text not null default 'available' check (status in ('available', 'reserved', 'sold')),
  -- An annonce that shows this unit in detail, if the agence published one.
  listing_id  uuid references public.listings(id) on delete set null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_units_ref_once unique (project_id, ref)
);

create index if not exists project_units_project_idx on public.project_units (project_id, sort_order, ref);

drop trigger if exists _touch_projects on public.projects;
create trigger _touch_projects before update on public.projects
  for each row execute function public._touch_updated_at();

drop trigger if exists _touch_project_units on public.project_units;
create trigger _touch_project_units before update on public.project_units
  for each row execute function public._touch_updated_at();

alter table public.projects enable row level security;
alter table public.project_units enable row level security;
revoke all on table public.projects, public.project_units from anon, authenticated;
grant all on table public.projects, public.project_units to service_role;

notify pgrst, 'reload schema';
