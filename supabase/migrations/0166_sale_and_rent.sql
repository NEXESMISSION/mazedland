-- ============================================================================
-- 0166 · An annonce is for sale or for rent
--
-- Until now every annonce was a sale. Rent is not a category — the same flat is
-- let or sold — so it is a column on the annonce, and the facts that only a
-- rental has get their own columns beside it, typed and checked, rather than
-- disappearing into `attributes` where search cannot range over them.
--
-- 1. listings.deal_type ('sale' | 'rent'). Every existing annonce is a sale.
--    `price` keeps one meaning per deal: the total for a sale, the monthly
--    rent for a rental.
-- 2. What a rental adds: deposit (caution), monthly charges on top of the
--    rent, furnished, the date it is free, the shortest lease the owner
--    accepts. Null means "not said" — 0 charges is a statement, null is not.
--    A sale carries none of them.
-- 3. listings.availability: a published rental (or sale) can be held for
--    someone — « réservé » — without leaving the catalogue. Let is a final
--    status, like sold: listing_status gains 'rented'.
-- 4. category_attributes.deal_types: a question asked only for one deal
--    (« titre foncier » is a buyer's question, not a tenant's). Null = both.
--    And the equipment a tenant filters on, for the categories it fits.
-- 5. The new columns are readable like the rest of the annonce (0157 grants
--    listings column by column).
--
-- Idempotent: if not exists / guarded constraints / on conflict do nothing.
-- ============================================================================

-- ── 1–3. listings ───────────────────────────────────────────────────────────
alter table public.listings
  add column if not exists deal_type        text not null default 'sale',
  add column if not exists deposit_amount   numeric(12,2),
  add column if not exists charges_amount   numeric(12,2),
  add column if not exists furnished        text,
  add column if not exists available_from   date,
  add column if not exists min_lease_months smallint,
  add column if not exists availability     text not null default 'available';

do $$
begin
  alter table public.listings add constraint listings_deal_type_chk
    check (deal_type in ('sale', 'rent'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.listings add constraint listings_rent_amounts_chk
    check ((deposit_amount is null or deposit_amount >= 0)
       and (charges_amount is null or charges_amount >= 0));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.listings add constraint listings_furnished_chk
    check (furnished is null or furnished in ('furnished', 'semi', 'unfurnished'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.listings add constraint listings_min_lease_chk
    check (min_lease_months is null or min_lease_months between 1 and 120);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.listings add constraint listings_availability_chk
    check (availability in ('available', 'reserved'));
exception when duplicate_object then null;
end $$;

-- A sale says nothing about deposits or leases: the form never asks, and a
-- stray value would show up on a page that has no place for it.
do $$
begin
  alter table public.listings add constraint listings_rent_fields_only_for_rent
    check (deal_type = 'rent' or (deposit_amount is null and charges_amount is null
           and furnished is null and available_from is null and min_lease_months is null));
exception when duplicate_object then null;
end $$;

-- Usable once this transaction commits; nothing below refers to it.
alter type public.listing_status add value if not exists 'rented';

create index if not exists listings_published_deal_idx
  on public.listings (deal_type, published_at desc)
  where status = 'published';

create index if not exists listings_published_deal_price_idx
  on public.listings (deal_type, price)
  where status = 'published';

-- ── 4. category_attributes ──────────────────────────────────────────────────
alter table public.category_attributes
  add column if not exists deal_types text[];

do $$
begin
  alter table public.category_attributes add constraint category_attributes_deal_types_chk
    check (deal_types is null or deal_types <@ array['sale', 'rent']::text[]);
exception when duplicate_object then null;
end $$;

-- Buying land is about the title and whether you may build; renting it is not.
update public.category_attributes
   set deal_types = array['sale']
 where field_key in ('titled', 'buildable')
   and deal_types is null;

insert into public.category_attributes
  (category_id, field_key, label, data_type, unit, required, filterable, sort_order)
select c.id, a.field_key, a.label, 'boolean', null, false, true, a.sort_order
  from public.categories c
  join (values
    ('appartements',       'air_conditioning', 'Climatisation',    60),
    ('appartements',       'heating',          'Chauffage central', 61),
    ('appartements',       'elevator',         'Ascenseur',         62),
    ('appartements',       'parking',          'Parking / garage',  63),
    ('maisons',            'air_conditioning', 'Climatisation',    60),
    ('maisons',            'heating',          'Chauffage central', 61),
    ('maisons',            'parking',          'Parking / garage',  63),
    ('maisons',            'garden',           'Jardin',            64),
    ('maisons',            'pool',             'Piscine',           65),
    ('villas',             'air_conditioning', 'Climatisation',    60),
    ('villas',             'heating',          'Chauffage central', 61),
    ('villas',             'parking',          'Parking / garage',  63),
    ('villas',             'garden',           'Jardin',            64),
    ('villas',             'pool',             'Piscine',           65),
    ('bureaux',            'air_conditioning', 'Climatisation',    60),
    ('bureaux',            'elevator',         'Ascenseur',         62),
    ('bureaux',            'parking',          'Parking / garage',  63),
    ('locaux-commerciaux', 'air_conditioning', 'Climatisation',    60),
    ('locaux-commerciaux', 'parking',          'Parking / garage',  63),
    ('depots',             'parking',          'Parking / garage',  63)
  ) as a(slug, field_key, label, sort_order) on a.slug = c.slug
on conflict (category_id, field_key) do nothing;

-- ── 5. read grants for the new columns (see 0157) ───────────────────────────
grant select (
  deal_type, deposit_amount, charges_amount, furnished, available_from,
  min_lease_months, availability
) on public.listings to anon, authenticated;
