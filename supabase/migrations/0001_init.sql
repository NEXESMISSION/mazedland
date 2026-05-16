-- ============================================================================
-- Batta.tn — initial schema
--
-- Domain model derived from the business plan §6, §7, §8, §9, §16.
-- Every table is RLS-enabled; the policies at the bottom open public-read
-- only on the rows that should be public (live auctions, approved
-- inspectors, vetted properties), and lock writes to the row owner or a
-- platform admin.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ─── ENUMS ──────────────────────────────────────────────────────────────────

do $$ begin
  create type user_role as enum ('individual', 'agency', 'bank', 'bailiff', 'inspector', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type kyc_status as enum ('none', 'submitted', 'pending', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type property_type as enum (
    'apartment', 'house', 'villa', 'land', 'commercial', 'office', 'warehouse', 'farm'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type property_status as enum ('draft', 'pending_review', 'rejected', 'ready', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type auction_type as enum ('english', 'sealed', 'dutch');
exception when duplicate_object then null; end $$;

do $$ begin
  create type auction_status as enum (
    'scheduled', 'live', 'extending', 'ended_sold', 'ended_unsold',
    'sixth_offer_window', 'awarded', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type inspection_status as enum (
    'requested', 'scheduled', 'in_progress', 'submitted', 'approved', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_provider as enum ('konnect', 'paymee', 'flouci', 'd17', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_kind as enum ('deposit_lock', 'deposit_release', 'commission', 'inspection_fee', 'subscription');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'authorized', 'captured', 'refunded', 'failed');
exception when duplicate_object then null; end $$;

-- ─── PROFILES ───────────────────────────────────────────────────────────────
-- Mirrors auth.users 1:1, holds role + KYC state + display fields.

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  phone           text,
  role            user_role not null default 'individual',
  kyc_status      kyc_status not null default 'none',
  kyc_submitted_at timestamptz,
  kyc_verified_at timestamptz,
  trust_score     int not null default 0 check (trust_score between 0 and 100),
  language        text not null default 'ar' check (language in ('ar','fr','en')),
  is_diaspora     boolean not null default false,
  governorate     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);

-- KYC submissions (CIN + selfie + financial proof).

create table if not exists public.kyc_submissions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  cin_front_path    text not null,
  cin_back_path     text not null,
  selfie_path       text not null,
  financial_proof_path text,
  status            kyc_status not null default 'submitted',
  reviewer_id       uuid references public.profiles(id),
  reviewer_notes    text,
  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz
);
create index if not exists kyc_user_idx on public.kyc_submissions(user_id);
create index if not exists kyc_status_idx on public.kyc_submissions(status);

-- ─── PROPERTIES ─────────────────────────────────────────────────────────────

create table if not exists public.properties (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete restrict,
  title           text not null,
  description     text,
  type            property_type not null,
  area_sqm        int check (area_sqm > 0),
  rooms           int check (rooms >= 0),
  bathrooms       int check (bathrooms >= 0),
  floor           int,
  year_built      int check (year_built between 1800 and 2100),
  governorate     text not null,
  delegation      text,
  address         text,
  -- Coordinates stored as plain lat/lng for simplicity; if we need PostGIS
  -- queries (radius search) later we can add a geography column.
  lat             numeric(9,6),
  lng             numeric(9,6),
  status          property_status not null default 'draft',
  rejection_reason text,
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists properties_owner_idx on public.properties(owner_id);
create index if not exists properties_status_idx on public.properties(status);
create index if not exists properties_governorate_idx on public.properties(governorate);
create index if not exists properties_type_idx on public.properties(type);

create table if not exists public.property_photos (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  storage_path text not null,
  caption      text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists property_photos_property_idx on public.property_photos(property_id, sort_order);

-- Legal documents (rsm 3aqari, certificat de propriété, etc.). Visibility
-- is controlled via storage policies, not row-level — only KYC-verified
-- users with an active deposit lock should be able to download originals.
create table if not exists public.property_documents (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  kind         text not null,
  storage_path text not null,
  uploaded_at  timestamptz not null default now()
);
create index if not exists property_documents_property_idx on public.property_documents(property_id);

-- ─── AUCTIONS ───────────────────────────────────────────────────────────────

create table if not exists public.auctions (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete restrict,
  type            auction_type not null,
  opening_price   numeric(14,2) not null check (opening_price > 0),
  reserve_price   numeric(14,2) check (reserve_price is null or reserve_price >= opening_price),
  -- Dutch only: starts here and ticks down toward opening_price.
  dutch_start_price numeric(14,2),
  dutch_floor_price numeric(14,2),
  dutch_decrement   numeric(14,2),
  dutch_tick_seconds int,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  -- Anti-sniping: when a bid lands inside the last `extend_window_seconds`,
  -- the end time is pushed by `extend_by_seconds`. Defaults match the
  -- plan §8: 5 min trigger window, 10 min extension.
  extend_window_seconds int not null default 300,
  extend_by_seconds     int not null default 600,
  status          auction_status not null default 'scheduled',
  current_price   numeric(14,2),
  -- Set when the auction closes and the +1/6 (sixth) law window opens.
  -- Per Tunisian rules the original winner has 8 days during which
  -- anyone may submit a higher offer (≥ winning + 1/6).
  sixth_offer_deadline timestamptz,
  winner_user_id  uuid references public.profiles(id),
  winner_amount   numeric(14,2),
  hammer_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists auctions_property_idx on public.auctions(property_id);
create index if not exists auctions_status_idx on public.auctions(status);
create index if not exists auctions_ends_idx on public.auctions(ends_at);

-- Per-bidder participation deposit lock (10% of opening per the plan).
create table if not exists public.auction_deposits (
  id            uuid primary key default gen_random_uuid(),
  auction_id    uuid not null references public.auctions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  amount        numeric(14,2) not null check (amount > 0),
  payment_id    uuid,
  released_at   timestamptz,
  forfeited_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (auction_id, user_id)
);
create index if not exists auction_deposits_auction_idx on public.auction_deposits(auction_id);

-- Bids. Sealed-bid auctions hide `amount` from non-admins via RLS until
-- the auction ends (enforced in the policy at the bottom).
create table if not exists public.bids (
  id           uuid primary key default gen_random_uuid(),
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  bidder_id    uuid not null references public.profiles(id) on delete restrict,
  amount       numeric(14,2) not null check (amount > 0),
  -- Proxy bidding: the user's max willingness; the engine raises in
  -- min increments on their behalf.
  max_amount   numeric(14,2),
  is_proxy     boolean not null default false,
  is_winning   boolean not null default false,
  ip_address   inet,
  device_hash  text,
  placed_at    timestamptz not null default now()
);
create index if not exists bids_auction_idx on public.bids(auction_id, placed_at desc);
create index if not exists bids_bidder_idx on public.bids(bidder_id);

-- Sixth-offer (offre du sixième) — the post-hammer 8-day window.
create table if not exists public.sixth_offers (
  id           uuid primary key default gen_random_uuid(),
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  bidder_id    uuid not null references public.profiles(id) on delete restrict,
  amount       numeric(14,2) not null check (amount > 0),
  placed_at    timestamptz not null default now()
);
create index if not exists sixth_offers_auction_idx on public.sixth_offers(auction_id);

-- ─── INSPECTOR NETWORK ──────────────────────────────────────────────────────

create table if not exists public.inspectors (
  id              uuid primary key references public.profiles(id) on delete cascade,
  speciality      text not null check (
    speciality in ('architect','civil_engineer','real_estate_expert','property_lawyer')
  ),
  governorates    text[] not null default '{}',
  diploma_path    text,
  insurance_path  text,
  approved        boolean not null default false,
  approved_at     timestamptz,
  rating_avg      numeric(3,2) default 0,
  rating_count    int not null default 0,
  bio             text,
  created_at      timestamptz not null default now()
);
create index if not exists inspectors_approved_idx on public.inspectors(approved);
create index if not exists inspectors_governorates_idx on public.inspectors using gin(governorates);

create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  requested_by    uuid not null references public.profiles(id) on delete restrict,
  inspector_id    uuid references public.inspectors(id),
  kind            text not null check (kind in ('standard','full','virtual_live')),
  scheduled_at    timestamptz,
  status          inspection_status not null default 'requested',
  fee_amount      numeric(10,2) not null,
  fee_payment_id  uuid,
  report_pdf_path text,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists inspections_property_idx on public.inspections(property_id);
create index if not exists inspections_inspector_idx on public.inspections(inspector_id);

-- ─── PAYMENTS ───────────────────────────────────────────────────────────────

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  kind         payment_kind not null,
  provider     payment_provider not null,
  provider_ref text,
  amount       numeric(14,2) not null check (amount > 0),
  currency     text not null default 'TND',
  status       payment_status not null default 'pending',
  -- Polymorphic FKs: which entity does this charge relate to?
  auction_id   uuid references public.auctions(id) on delete set null,
  inspection_id uuid references public.inspections(id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments(user_id);
create index if not exists payments_auction_idx on public.payments(auction_id);
create index if not exists payments_status_idx on public.payments(status);

-- ─── WAITLIST ───────────────────────────────────────────────────────────────

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      citext unique not null,
  phone      text,
  locale     text not null default 'ar' check (locale in ('ar','fr','en')),
  source     text,
  created_at timestamptz not null default now()
);

-- ─── TRIGGERS: bump updated_at on every UPDATE ──────────────────────────────

create or replace function public._touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public._touch_updated_at();

drop trigger if exists touch_properties on public.properties;
create trigger touch_properties before update on public.properties
  for each row execute function public._touch_updated_at();

drop trigger if exists touch_auctions on public.auctions;
create trigger touch_auctions before update on public.auctions
  for each row execute function public._touch_updated_at();

drop trigger if exists touch_payments on public.payments;
create trigger touch_payments before update on public.payments
  for each row execute function public._touch_updated_at();

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
-- Defense-in-depth: every public.* table has RLS on. Policies are scoped
-- to the principal in auth.uid(). The "admin" role bypass uses an
-- app_metadata claim rather than a SECURITY DEFINER function so a
-- compromised admin's session token alone is enough to grant access —
-- no sql injection vector through the helper.

alter table public.profiles enable row level security;
alter table public.kyc_submissions enable row level security;
alter table public.properties enable row level security;
alter table public.property_photos enable row level security;
alter table public.property_documents enable row level security;
alter table public.auctions enable row level security;
alter table public.auction_deposits enable row level security;
alter table public.bids enable row level security;
alter table public.sixth_offers enable row level security;
alter table public.inspectors enable row level security;
alter table public.inspections enable row level security;
alter table public.payments enable row level security;
alter table public.waitlist enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- profiles: a user can read/update their own row; admins see all.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select
  using (auth.uid() = id or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- kyc_submissions: own only; admins review.
drop policy if exists kyc_self_rw on public.kyc_submissions;
create policy kyc_self_rw on public.kyc_submissions for all
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- properties: anyone can read 'ready' (publishable) ones; owner manages
-- their own; admin manages all.
drop policy if exists properties_public_read on public.properties;
create policy properties_public_read on public.properties for select
  using (status = 'ready' or auth.uid() = owner_id or public.is_admin());
drop policy if exists properties_owner_write on public.properties;
create policy properties_owner_write on public.properties for all
  using (auth.uid() = owner_id or public.is_admin())
  with check (auth.uid() = owner_id or public.is_admin());

-- photos / documents: same visibility pattern as the parent property.
drop policy if exists property_photos_read on public.property_photos;
create policy property_photos_read on public.property_photos for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and (p.status = 'ready' or auth.uid() = p.owner_id or public.is_admin())
    )
  );
drop policy if exists property_photos_write on public.property_photos;
create policy property_photos_write on public.property_photos for all
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and (auth.uid() = p.owner_id or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id and (auth.uid() = p.owner_id or public.is_admin())
    )
  );

drop policy if exists property_documents_read on public.property_documents;
create policy property_documents_read on public.property_documents for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and (auth.uid() = p.owner_id or public.is_admin())
    )
    or exists (
      select 1 from public.auction_deposits d
      join public.auctions a on a.id = d.auction_id
      where a.property_id = public.property_documents.property_id
        and d.user_id = auth.uid()
        and d.released_at is null and d.forfeited_at is null
    )
  );
drop policy if exists property_documents_write on public.property_documents;
create policy property_documents_write on public.property_documents for all
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and (auth.uid() = p.owner_id or public.is_admin())
    )
  ) with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id and (auth.uid() = p.owner_id or public.is_admin())
    )
  );

-- auctions: public read for everything except cancelled drafts.
drop policy if exists auctions_public_read on public.auctions;
create policy auctions_public_read on public.auctions for select
  using (status <> 'cancelled' or public.is_admin());
drop policy if exists auctions_owner_write on public.auctions;
create policy auctions_owner_write on public.auctions for all
  using (
    public.is_admin() or exists (
      select 1 from public.properties p
      where p.id = property_id and p.owner_id = auth.uid()
    )
  ) with check (
    public.is_admin() or exists (
      select 1 from public.properties p
      where p.id = property_id and p.owner_id = auth.uid()
    )
  );

-- deposits: bidder reads own; auction owner sees aggregates via RPC, not
-- via direct row access.
drop policy if exists deposits_self on public.auction_deposits;
create policy deposits_self on public.auction_deposits for all
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- bids: English/Dutch are public-read; sealed-bid hides amounts from
-- non-bidders until the auction ends. The id+bidder_id are visible
-- (bid count) but `amount` is masked client-side; we still expose the
-- row so the UI knows a bid happened, and gate the amount via a view.
drop policy if exists bids_read on public.bids;
create policy bids_read on public.bids for select
  using (
    public.is_admin()
    or auth.uid() = bidder_id
    or exists (
      select 1 from public.auctions a
      where a.id = auction_id
        and (
          a.type <> 'sealed'
          or a.status in ('ended_sold','ended_unsold','sixth_offer_window','awarded')
        )
    )
  );
drop policy if exists bids_insert_self on public.bids;
create policy bids_insert_self on public.bids for insert
  with check (auth.uid() = bidder_id);

-- sixth offers: same visibility as bids on a closed auction (always
-- public-read once the window opens).
drop policy if exists sixth_offers_read on public.sixth_offers;
create policy sixth_offers_read on public.sixth_offers for select using (true);
drop policy if exists sixth_offers_insert_self on public.sixth_offers;
create policy sixth_offers_insert_self on public.sixth_offers for insert
  with check (auth.uid() = bidder_id);

-- inspectors: approved profiles are public; the inspector edits their own.
drop policy if exists inspectors_public_read on public.inspectors;
create policy inspectors_public_read on public.inspectors for select
  using (approved or auth.uid() = id or public.is_admin());
drop policy if exists inspectors_self_write on public.inspectors;
create policy inspectors_self_write on public.inspectors for all
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- inspections: visible to requester, assigned inspector, property owner, admin.
drop policy if exists inspections_visible on public.inspections;
create policy inspections_visible on public.inspections for select
  using (
    public.is_admin()
    or auth.uid() = requested_by
    or auth.uid() = inspector_id
    or exists (
      select 1 from public.properties p
      where p.id = property_id and p.owner_id = auth.uid()
    )
  );
drop policy if exists inspections_requester_insert on public.inspections;
create policy inspections_requester_insert on public.inspections for insert
  with check (auth.uid() = requested_by);
drop policy if exists inspections_assignee_update on public.inspections;
create policy inspections_assignee_update on public.inspections for update
  using (auth.uid() = inspector_id or public.is_admin())
  with check (auth.uid() = inspector_id or public.is_admin());

-- payments: own only; admins see everything.
drop policy if exists payments_self on public.payments;
create policy payments_self on public.payments for select
  using (auth.uid() = user_id or public.is_admin());
drop policy if exists payments_self_insert on public.payments;
create policy payments_self_insert on public.payments for insert
  with check (auth.uid() = user_id);

-- waitlist: anonymous insert allowed (it's the pre-launch landing page);
-- only admins can read.
drop policy if exists waitlist_anon_insert on public.waitlist;
create policy waitlist_anon_insert on public.waitlist for insert
  with check (true);
drop policy if exists waitlist_admin_read on public.waitlist;
create policy waitlist_admin_read on public.waitlist for select
  using (public.is_admin());
