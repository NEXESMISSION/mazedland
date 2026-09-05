-- ============================================================================
-- 0145 — Listings taxonomy: the catalogue Mazed Land is pivoting to.
--
-- Same move Mazed Auto made (its 0153): stop being an auction house, become a
-- classifieds marketplace where the price is shown and the buyer telephones the
-- seller. This file is the taxonomy half — the categories and the per-category
-- attribute definitions. Nothing reads it yet; 0146 adds the listings
-- themselves, and the UI comes after that.
--
-- WHAT IS DIFFERENT FROM MAZED AUTO. Its catalogue splits into vehicles and
-- spare parts, and a part carries `fitments` — which cars it fits. Property has
-- no equivalent and that table is not ported. What property has instead is a
-- meaningful split by what the thing IS, because it changes the questions worth
-- asking:
--
--   residential  rooms, bathrooms, floor, year built
--   land         surface, whether it can be built on, whether the title is clean
--   commercial   surface, floor, year built — no bedrooms
--
-- The eight `property_type` values from 0001_init map onto those three kinds,
-- so nothing an admin already configured is thrown away and every existing
-- property has a category to land in when it is backfilled.
--
-- Additive only: no existing table is altered or dropped. The auction tables
-- are untouched and keep working while this is built alongside them.
-- ============================================================================

-- ── Listing lifecycle ───────────────────────────────────────────────────────
-- draft            seller is still writing it
-- pending_payment  submitted, waiting on the publication fee (or a credit)
-- pending_review   paid (or credited, or admin-created) — in the moderation queue
-- published        live and visible to everyone
-- rejected         moderation refused it; rejection_reason says why
-- expired          ran past expires_at; renewable
-- archived         seller or admin took it down
-- sold             seller marked it sold. We are not in the transaction, so this
--                  is their word — it stops the calls, it is not a receipt.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'listing_status') then
    create type public.listing_status as enum (
      'draft', 'pending_payment', 'pending_review', 'published',
      'rejected', 'expired', 'archived', 'sold'
    );
  end if;
end $$;

-- ── Categories ──────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.categories(id) on delete restrict,
  slug        text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label_fr    text not null,
  label_ar    text,
  -- What KIND of thing this is, which drives the form and the filters. A villa
  -- is asked for its bedrooms, a field is asked whether it can be built on.
  kind        text not null check (kind in ('residential', 'land', 'commercial')),
  icon        text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists categories_parent_idx on public.categories(parent_id, sort_order);
create index if not exists categories_active_idx on public.categories(is_active) where is_active;

drop trigger if exists _touch_categories on public.categories;
create trigger _touch_categories before update on public.categories
  for each row execute function public._touch_updated_at();

-- ── Per-category attribute definitions ──────────────────────────────────────
-- Replaces property_attribute_kinds, plus `filterable`: an attribute a buyer
-- SEARCHES by (surface, rooms) is not the same as one they only read (year
-- built), and the catalogue page needs to know which is which.
create table if not exists public.category_attributes (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id) on delete cascade,
  field_key    text not null check (field_key ~ '^[a-z][a-z0-9_]*$'),
  label        text not null,
  data_type    text not null check (data_type in ('number', 'text', 'boolean', 'select')),
  options      jsonb,                       -- [{value,label}] for select
  unit         text,
  required     boolean not null default false,
  filterable   boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (category_id, field_key)
);
create index if not exists category_attributes_cat_idx
  on public.category_attributes(category_id, sort_order);

drop trigger if exists _touch_category_attributes on public.category_attributes;
create trigger _touch_category_attributes before update on public.category_attributes
  for each row execute function public._touch_updated_at();

-- ── RLS: the catalogue is public, only admins write it ──────────────────────
alter table public.categories          enable row level security;
alter table public.category_attributes enable row level security;

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select using (is_active or public.is_admin());

drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists category_attributes_public_read on public.category_attributes;
create policy category_attributes_public_read on public.category_attributes
  for select using (true);

drop policy if exists category_attributes_admin_write on public.category_attributes;
create policy category_attributes_admin_write on public.category_attributes
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.categories, public.category_attributes to anon, authenticated;
grant all    on public.categories, public.category_attributes to service_role;

-- ── Seed: the three branches ────────────────────────────────────────────────
insert into public.categories (slug, label_fr, label_ar, kind, icon, sort_order) values
  ('residentiel',  'Résidentiel',   'سكني',  'residential', 'home',      10),
  ('terrains',     'Terrains',      'أراضي', 'land',        'map',       20),
  ('professionnel','Professionnel', 'مهني',  'commercial',  'building',  30)
on conflict (slug) do nothing;

-- ── Seed: the leaves, one per property_type from 0001_init ──────────────────
-- Every value of the existing enum has a home here, so the backfill in a later
-- migration can map each property to a category without a judgement call.
insert into public.categories (parent_id, slug, label_fr, label_ar, kind, sort_order)
select p.id, v.slug, v.label_fr, v.label_ar, p.kind, v.sort_order
  from (values
    ('residentiel',  'appartements',      'Appartements',      'شقق',        10),
    ('residentiel',  'maisons',           'Maisons',           'منازل',      20),
    ('residentiel',  'villas',            'Villas',            'فيلات',      30),
    -- slug 'terrain', not 'terrains': the PARENT branch owns 'terrains', slug is
    -- unique, and `on conflict do nothing` would drop this row in silence —
    -- leaving the branch for actual plots of land with only farms under it.
    ('terrains',     'terrain',           'Terrains',          'أراضي',      10),
    ('terrains',     'fermes',            'Fermes',            'مزارع',      20),
    ('professionnel','locaux-commerciaux','Locaux commerciaux','محلات تجارية',10),
    ('professionnel','bureaux',           'Bureaux',           'مكاتب',      20),
    ('professionnel','depots',            'Dépôts',            'مستودعات',   30)
  ) as v(parent_slug, slug, label_fr, label_ar, sort_order)
  join public.categories p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- ── Seed: attributes, by kind ───────────────────────────────────────────────
-- Surface is the one number every property is compared on, so it is required
-- and filterable everywhere. The rest follow what the kind actually is.
insert into public.category_attributes
  (category_id, field_key, label, data_type, unit, required, filterable, sort_order)
select c.id, a.field_key, a.label, a.data_type, a.unit, a.required, a.filterable, a.sort_order
  from public.categories c
  join (values
    ('residential', 'area_sqm',   'Surface',              'number',  'm²', true,  true,  10),
    ('residential', 'rooms',      'Pièces',               'number',  null, true,  true,  20),
    ('residential', 'bathrooms',  'Salles de bain',       'number',  null, false, true,  30),
    ('residential', 'floor',      'Étage',                'number',  null, false, false, 40),
    ('residential', 'year_built', 'Année de construction','number',  null, false, false, 50),

    ('land',        'area_sqm',   'Surface',              'number',  'm²', true,  true,  10),
    ('land',        'buildable',  'Constructible',        'boolean', null, false, true,  20),
    ('land',        'titled',     'Titre foncier',        'boolean', null, false, true,  30),
    ('land',        'serviced',   'Viabilisé',            'boolean', null, false, true,  40),

    ('commercial',  'area_sqm',   'Surface',              'number',  'm²', true,  true,  10),
    ('commercial',  'floor',      'Étage',                'number',  null, false, false, 20),
    ('commercial',  'year_built', 'Année de construction','number',  null, false, false, 30)
  ) as a(kind, field_key, label, data_type, unit, required, filterable, sort_order)
    on a.kind = c.kind
 where c.parent_id is not null      -- leaves only; the branches are navigation
on conflict (category_id, field_key) do nothing;
