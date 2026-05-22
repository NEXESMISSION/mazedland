-- ============================================================================
-- Batta.tn — Per-type property characteristics
--
-- Two changes:
--   1. properties.attributes jsonb — flexible bag holding every
--      characteristic value, keyed by field_key (e.g. {"area_sqm":120,
--      "has_elevator":true,"title_type":"titre_bleu"}). This is the source
--      of truth for the public "Caractéristiques" section.
--   2. property_attribute_kinds — admin-controlled catalog (mirrors
--      legal_doc_kinds) that defines WHICH fields exist for each property
--      type, their input widget (number/text/boolean/select), unit, and
--      whether they're required. Editable from /admin/characteristics with
--      no code changes.
--
-- The five legacy columns (area_sqm, rooms, bathrooms, floor, year_built)
-- stay on `properties` and are kept in sync by the sell form (it mirrors
-- those canonical keys out of `attributes`), so existing read paths —
-- explore filters, listing cards — keep working unchanged.
-- ============================================================================

alter table public.properties
  add column if not exists attributes jsonb not null default '{}'::jsonb;

-- ─── Catalog ────────────────────────────────────────────────────────────────
create table if not exists public.property_attribute_kinds (
  id            uuid primary key default gen_random_uuid(),
  property_type property_type not null,
  -- Stable storage key inside properties.attributes. Never changes once set
  -- (renaming the label must NOT orphan stored values), so the admin API
  -- derives it from the label only on insert.
  field_key     text not null check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) <= 40),
  label         text not null check (length(label) between 1 and 60),
  -- Widget + value shape. 'select' uses `options`; everything else ignores it.
  data_type     text not null default 'number'
                  check (data_type in ('number', 'text', 'boolean', 'select')),
  -- For data_type='select': [{"value":"titre_bleu","label":"Titre bleu"}, ...]
  options       jsonb,
  -- Display suffix on the public sheet, e.g. "m²", "ha", "m".
  unit          text check (unit is null or length(unit) <= 12),
  required      boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (property_type, field_key)
);

create index if not exists property_attribute_kinds_type_sort_idx
  on public.property_attribute_kinds (property_type, sort_order, label);

create or replace function public.tg_property_attribute_kinds_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tg_property_attribute_kinds_touch on public.property_attribute_kinds;
create trigger tg_property_attribute_kinds_touch
before update on public.property_attribute_kinds
for each row execute function public.tg_property_attribute_kinds_touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Read: everyone (the sell form needs the catalog before any auth gate).
-- Write: admin only. Service role bypasses RLS for the API route's upserts.
alter table public.property_attribute_kinds enable row level security;

drop policy if exists property_attribute_kinds_read on public.property_attribute_kinds;
create policy property_attribute_kinds_read on public.property_attribute_kinds
for select using (true);

drop policy if exists property_attribute_kinds_admin_write on public.property_attribute_kinds;
create policy property_attribute_kinds_admin_write on public.property_attribute_kinds
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

grant select on public.property_attribute_kinds to anon, authenticated;
grant insert, update, delete on public.property_attribute_kinds to authenticated;

-- ─── Seed defaults ──────────────────────────────────────────────────────────
-- Sensible Tunisian real-estate field set per type. Admin can edit afterwards.
-- ON CONFLICT DO NOTHING so re-running the migration is idempotent.
insert into public.property_attribute_kinds
  (property_type, field_key, label, data_type, options, unit, required, sort_order)
values
  -- Appartement
  ('apartment', 'area_sqm',     'Surface',               'number',  null, 'm²', true,  10),
  ('apartment', 'rooms',        'Pièces',                'number',  null, null, false, 20),
  ('apartment', 'bathrooms',    'Salles de bain',        'number',  null, null, false, 30),
  ('apartment', 'floor',        'Étage',                 'number',  null, null, false, 40),
  ('apartment', 'year_built',   'Année de construction', 'number',  null, null, false, 50),
  ('apartment', 'has_elevator', 'Ascenseur',             'boolean', null, null, false, 60),
  ('apartment', 'parking',      'Parking',               'boolean', null, null, false, 70),
  ('apartment', 'furnished',    'Meublé',                'boolean', null, null, false, 80),

  -- Maison
  ('house', 'area_sqm',      'Surface',               'number',  null, 'm²', true,  10),
  ('house', 'land_area_sqm', 'Surface du terrain',    'number',  null, 'm²', false, 20),
  ('house', 'rooms',         'Pièces',                'number',  null, null, false, 30),
  ('house', 'bathrooms',     'Salles de bain',        'number',  null, null, false, 40),
  ('house', 'year_built',    'Année de construction', 'number',  null, null, false, 50),
  ('house', 'garden',        'Jardin',                'boolean', null, null, false, 60),
  ('house', 'garage',        'Garage',                'boolean', null, null, false, 70),

  -- Villa
  ('villa', 'area_sqm',      'Surface',               'number',  null, 'm²', true,  10),
  ('villa', 'land_area_sqm', 'Surface du terrain',    'number',  null, 'm²', false, 20),
  ('villa', 'rooms',         'Pièces',                'number',  null, null, false, 30),
  ('villa', 'bathrooms',     'Salles de bain',        'number',  null, null, false, 40),
  ('villa', 'year_built',    'Année de construction', 'number',  null, null, false, 50),
  ('villa', 'pool',          'Piscine',               'boolean', null, null, false, 60),
  ('villa', 'garden',        'Jardin',                'boolean', null, null, false, 70),
  ('villa', 'garage',        'Garage',                'boolean', null, null, false, 80),

  -- Terrain
  ('land', 'area_sqm',     'Surface',      'number',  null, 'm²', true,  10),
  ('land', 'title_type',   'Type de titre', 'select',
     '[{"value":"titre_bleu","label":"Titre bleu"},{"value":"titre_vert","label":"Titre vert"},{"value":"non_immatricule","label":"Non immatriculé"}]'::jsonb,
     null, false, 20),
  ('land', 'constructible', 'Constructible',            'boolean', null, null, false, 30),
  ('land', 'frontage_m',    'Façade',                   'number',  null, 'm',  false, 40),
  ('land', 'serviced',      'Viabilisé (eau/électricité)', 'boolean', null, null, false, 50),

  -- Local commercial
  ('commercial', 'area_sqm',   'Surface',               'number',  null, 'm²', true,  10),
  ('commercial', 'frontage_m', 'Façade',                'number',  null, 'm',  false, 20),
  ('commercial', 'floor',      'Étage',                 'number',  null, null, false, 30),
  ('commercial', 'shopfront',  'Vitrine',               'boolean', null, null, false, 40),
  ('commercial', 'parking',    'Parking',               'boolean', null, null, false, 50),
  ('commercial', 'year_built', 'Année de construction', 'number',  null, null, false, 60),

  -- Bureau
  ('office', 'area_sqm',         'Surface',               'number',  null, 'm²', true,  10),
  ('office', 'rooms',            'Pièces',                'number',  null, null, false, 20),
  ('office', 'bathrooms',        'Salles de bain',        'number',  null, null, false, 30),
  ('office', 'floor',            'Étage',                 'number',  null, null, false, 40),
  ('office', 'has_elevator',     'Ascenseur',             'boolean', null, null, false, 50),
  ('office', 'air_conditioning', 'Climatisation',         'boolean', null, null, false, 60),
  ('office', 'year_built',       'Année de construction', 'number',  null, null, false, 70),

  -- Entrepôt
  ('warehouse', 'area_sqm',         'Surface',               'number',  null, 'm²', true,  10),
  ('warehouse', 'ceiling_height_m', 'Hauteur sous plafond',  'number',  null, 'm',  false, 20),
  ('warehouse', 'loading_docks',    'Quais de chargement',   'number',  null, null, false, 30),
  ('warehouse', 'truck_access',     'Accès poids lourd',     'boolean', null, null, false, 40),
  ('warehouse', 'year_built',       'Année de construction', 'number',  null, null, false, 50),

  -- Ferme
  ('farm', 'area_sqm',     'Surface',       'number', null, 'ha', true,  10),
  ('farm', 'water_source', 'Source d''eau', 'select',
     '[{"value":"puits","label":"Puits"},{"value":"forage","label":"Forage"},{"value":"sonede","label":"SONEDE"},{"value":"aucune","label":"Aucune"}]'::jsonb,
     null, false, 20),
  ('farm', 'soil_type',    'Type de sol',   'text',    null, null, false, 30),
  ('farm', 'buildings',    'Bâtiments',     'boolean', null, null, false, 40)
on conflict (property_type, field_key) do nothing;

notify pgrst, 'reload schema';
