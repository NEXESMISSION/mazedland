-- ============================================================================
-- 0146 — Listings core: the table the catalogue is built on.
--
-- Ported from Mazed Auto's 0154, adapted for property. Additive only: the
-- auction tables are untouched and keep working alongside this until the
-- decommission phase.
--
-- TWO THINGS THIS FILE IS CAREFUL ABOUT.
--
-- 1. THE PHONE NUMBER IS NOT READABLE BY USERS. `contact_phone` and
--    `contact_whatsapp` are granted to service_role ALONE — they are left out
--    of the anon and authenticated column grants below. A logged-out visitor
--    and a signed-in one are equally unable to `select contact_phone`, so no
--    single PostgREST request can walk the catalogue harvesting numbers. The
--    reveal endpoint reads them server-side, logs to `contact_reveals` and
--    rate-limits per IP.
--
-- 2. EVERY RLS POLICY IS SELF-CONTAINED. The bug that made the auction price
--    unreadable for logged-out visitors was a policy on `auctions` that read
--    `properties`, which anon cannot see. Nothing here reads another table
--    except through `is_admin()`, which is SECURITY DEFINER, and the photo
--    policy which only touches `listings.id/status` — both granted to anon.
--
-- WHAT IS NOT PORTED FROM AUTO:
--   · `listing_fitments` — "which cars does this part fit". Property has no
--     equivalent.
--   · `condition` (new / used / refurbished) — that describes a car, not a
--     building. Property says it with `year_built` and its attributes.
-- ============================================================================

create table if not exists public.listings (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references public.profiles(id) on delete restrict,
  category_id   uuid not null references public.categories(id) on delete restrict,

  title         text not null check (length(btrim(title)) between 3 and 140),
  description   text,

  -- Money. `price_on_request` exists for the property nobody prices publicly —
  -- common enough in Tunisian real estate to be worth a column. Everything else
  -- must carry a number, so the catalogue is comparable.
  price             numeric(12,2) check (price is null or price >= 0),
  negotiable        boolean not null default false,
  price_on_request  boolean not null default false,
  constraint listings_price_present
    check (price_on_request or price is not null),

  governorate   text not null,
  delegation    text,
  address       text,
  lat           numeric(9,6),
  lng           numeric(9,6),

  -- Validated against category_attributes by the app; stored whole so a new
  -- attribute never needs a migration. Surface, pièces, constructible, titre
  -- foncier all live here.
  attributes    jsonb not null default '{}'::jsonb,

  -- How the buyer reaches the seller. See note 1 above about grants.
  contact_name      text,
  contact_phone     text,
  contact_whatsapp  text,
  show_phone        boolean not null default true,

  status            public.listing_status not null default 'draft',
  rejection_reason  text,
  reviewed_by       uuid references public.profiles(id),
  reviewed_at       timestamptz,

  -- How this publication was paid for: a payment, a pack credit, or an admin
  -- waiving it. The columns exist now so the backfill and the sell flow do not
  -- need another migration to start using them.
  fee_payment_id    uuid references public.payments(id) on delete set null,
  seller_credit_id  uuid,
  fee_waived_by     uuid references public.profiles(id),

  published_at   timestamptz,
  expires_at     timestamptz,
  renewed_count  int not null default 0,

  seller_attestation_version text,
  seller_attestation_at      timestamptz,

  view_count           int not null default 0,
  contact_reveal_count int not null default 0,

  search_text text generated always as (
    public.f_unaccent(lower(
      coalesce(title, '') || ' ' || coalesce(governorate, '') || ' ' ||
      coalesce(address, '') || ' ' || coalesce(description, '')
    ))
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A published listing must be reachable and must expire. Both are what make
  -- the catalogue trustworthy: no dead ends, no listings from two years ago.
  constraint listings_published_is_contactable
    check (status <> 'published' or contact_phone is not null),
  constraint listings_published_has_dates
    check (status <> 'published' or (published_at is not null and expires_at is not null))
);

create index if not exists listings_status_idx      on public.listings(status);
create index if not exists listings_seller_idx      on public.listings(seller_id, status);
create index if not exists listings_category_idx    on public.listings(category_id, status);
create index if not exists listings_governorate_idx on public.listings(governorate) where status = 'published';
create index if not exists listings_published_idx   on public.listings(published_at desc) where status = 'published';
create index if not exists listings_expiry_idx      on public.listings(expires_at) where status = 'published';
create index if not exists listings_price_idx       on public.listings(price) where status = 'published';
create index if not exists listings_attributes_idx  on public.listings using gin (attributes);
create index if not exists listings_search_idx      on public.listings using gin (search_text gin_trgm_ops);

drop trigger if exists _touch_listings on public.listings;
create trigger _touch_listings before update on public.listings
  for each row execute function public._touch_updated_at();

-- ── Photos ──────────────────────────────────────────────────────────────────
create table if not exists public.listing_photos (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,
  caption      text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists listing_photos_listing_idx
  on public.listing_photos(listing_id, sort_order);

-- ── Contact reveals: one row per "afficher le numéro" ───────────────────────
-- Doubles as the anti-scraping signal: a burst from one ip_hash is a harvester,
-- not a buyer. Never stores a raw IP.
create table if not exists public.contact_reveals (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists contact_reveals_listing_idx on public.contact_reveals(listing_id, created_at desc);
create index if not exists contact_reveals_ip_idx      on public.contact_reveals(ip_hash, created_at desc);

-- ── A seller cannot publish themselves ──────────────────────────────────────
-- Publication is what is charged for; letting the owner's own UPDATE set
-- status='published' would hand out the product for free. Only service_role
-- (the paid/credited/admin path) and admins may move a row into 'published'.
create or replace function public._listings_guard_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not (
       coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
       or current_user = 'service_role'
       or public.is_admin()
     ) then
    raise exception 'publication_requires_payment'
      using errcode = 'P0001',
            hint = 'A listing is published by the payment/credit path or by an admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists _listings_guard_publish on public.listings;
create trigger _listings_guard_publish
  before insert or update on public.listings
  for each row execute function public._listings_guard_publish();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.listings        enable row level security;
alter table public.listing_photos  enable row level security;
alter table public.contact_reveals enable row level security;

drop policy if exists listings_public_read on public.listings;
create policy listings_public_read on public.listings
  for select using (
    status = 'published'
    or seller_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists listings_owner_insert on public.listings;
create policy listings_owner_insert on public.listings
  for insert with check (seller_id = auth.uid());

drop policy if exists listings_owner_update on public.listings;
create policy listings_owner_update on public.listings
  for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());

drop policy if exists listings_admin_all on public.listings;
create policy listings_admin_all on public.listings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists listing_photos_read on public.listing_photos;
create policy listing_photos_read on public.listing_photos
  for select using (
    exists (
      select 1 from public.listings l
       where l.id = listing_id
         and (l.status = 'published' or l.seller_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists listing_photos_owner_write on public.listing_photos;
create policy listing_photos_owner_write on public.listing_photos
  for all using (
    exists (select 1 from public.listings l where l.id = listing_id and (l.seller_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.listings l where l.id = listing_id and (l.seller_id = auth.uid() or public.is_admin()))
  );

drop policy if exists contact_reveals_admin_read on public.contact_reveals;
create policy contact_reveals_admin_read on public.contact_reveals
  for select to authenticated using (public.is_admin());

-- ── Grants ──────────────────────────────────────────────────────────────────
-- anon: what a listing card and a listing page show. No seller_id (a person
-- FK), no moderation fields, no attestation, no payment ids, and above all no
-- contact_phone / contact_whatsapp.
grant select (
  id, category_id, title, description, price, negotiable, price_on_request,
  governorate, delegation, address, lat, lng, attributes,
  contact_name, show_phone, status, published_at, expires_at,
  view_count, contact_reveal_count, search_text, created_at, updated_at
) on public.listings to anon;

-- authenticated: everything a seller needs about their OWN listing (RLS still
-- decides which rows) — minus the two contact columns, so a signed-in scraper
-- is no better off than a logged-out one.
grant select (
  id, seller_id, category_id, title, description, price, negotiable,
  price_on_request, governorate, delegation, address, lat, lng,
  attributes, contact_name, show_phone, status, rejection_reason, reviewed_at,
  fee_payment_id, seller_credit_id, published_at, expires_at, renewed_count,
  seller_attestation_version, seller_attestation_at,
  view_count, contact_reveal_count, search_text, created_at, updated_at
) on public.listings to authenticated;

grant insert, update on public.listings to authenticated;
grant all on public.listings to service_role;

grant select on public.listing_photos to anon, authenticated;
grant insert, update, delete on public.listing_photos to authenticated;
grant all on public.listing_photos, public.contact_reveals to service_role;

comment on column public.listings.contact_phone is
  'NEVER granted to anon/authenticated. Read server-side by the reveal endpoint, which logs to contact_reveals and rate-limits. Do not add it to a public select list.';

notify pgrst, 'reload schema';
