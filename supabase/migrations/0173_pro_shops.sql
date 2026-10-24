-- ============================================================================
-- 0173 · Mazed Immo Pro: shops, their team, their subscription
--
-- Cahier global V1 §03. A professional — agency, developer, land developer,
-- property manager — opens a shop with the account they already have. The
-- shop's annonces are ordinary annonces with a `shop_id`: they show in the
-- shop AND in the marketplace, one row, no copy.
--
-- 1. shops — the public page (slug, name, kind, logo, description, place,
--    contacts) and two separate decisions: `status` (an admin let it open:
--    pending → approved / rejected / suspended) and `verified_at` (an admin
--    checked who they are). Paying never verifies anyone.
-- 2. shop_members — the owner and the people they add: owner, admin, agent.
--    Rights are checked by the server, never by the browser.
-- 3. shop_subscriptions — one row per paid period of a plan (a `products`
--    row of kind « subscription »). Active while status = active and
--    ends_at is in the future; nothing deletes anything when it runs out.
-- 4. shop_documents — the papers behind « vérifié » (RNE, patente…), in a
--    private bucket: only the shop's owner and the admins see them.
-- 5. listings.shop_id — whose shop an annonce belongs to.
-- 6. The three plans decided on 2026-10-24: Starter 29, Pro 59, Business 119
--    TND a month, for 10, 40 and 120 live annonces.
--
-- Server only (service role); the pages read through it. Idempotent.
-- ============================================================================

-- ── 1. shops ───────────────────────────────────────────────────────────────
create table if not exists public.shops (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles(id) on delete restrict,
  slug              text not null
                      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name              text not null check (char_length(name) between 2 and 80),
  kind              text not null check (kind in ('agency', 'promoter', 'land_developer', 'property_manager')),
  description       text check (description is null or char_length(description) <= 2000),
  logo_path         text,
  cover_path        text,
  governorate       text not null,
  city              text check (city is null or char_length(city) <= 80),
  phone             text,
  email             text check (email is null or char_length(email) <= 120),
  website           text check (website is null or char_length(website) <= 200),
  hours             text check (hours is null or char_length(hours) <= 200),
  legal_name        text check (legal_name is null or char_length(legal_name) <= 120),
  legal_id          text check (legal_id is null or char_length(legal_id) <= 60),
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'suspended')),
  rejection_reason  text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  verified_at       timestamptz,
  verified_by       uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint shops_slug_once unique (slug)
);

create index if not exists shops_status_idx on public.shops (status, created_at desc);
create index if not exists shops_owner_idx on public.shops (owner_id);

drop trigger if exists _touch_shops on public.shops;
create trigger _touch_shops before update on public.shops
  for each row execute function public._touch_updated_at();

alter table public.shops enable row level security;
revoke all on table public.shops from anon, authenticated;

-- ── 2. shop_members ────────────────────────────────────────────────────────
create table if not exists public.shop_members (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'agent')),
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create index if not exists shop_members_user_idx on public.shop_members (user_id);

alter table public.shop_members enable row level security;
revoke all on table public.shop_members from anon, authenticated;

-- ── 3. shop_subscriptions ──────────────────────────────────────────────────
create table if not exists public.shop_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete restrict,
  payment_id     uuid references public.payments(id) on delete set null,
  status         text not null default 'active' check (status in ('active', 'cancelled')),
  listing_quota  integer not null check (listing_quota > 0),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  granted_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint shop_subscriptions_period check (ends_at > starts_at),
  -- One paid period per payment: a receipt accepted twice grants once.
  constraint shop_subscriptions_payment_once unique (payment_id)
);

create index if not exists shop_subscriptions_shop_idx on public.shop_subscriptions (shop_id, ends_at desc);

alter table public.shop_subscriptions enable row level security;
revoke all on table public.shop_subscriptions from anon, authenticated;

-- ── 4. shop_documents ──────────────────────────────────────────────────────
create table if not exists public.shop_documents (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  kind          text not null check (kind in ('rne', 'patente', 'identity', 'other')),
  storage_path  text not null,
  file_name     text check (file_name is null or char_length(file_name) <= 160),
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists shop_documents_shop_idx on public.shop_documents (shop_id, created_at desc);

alter table public.shop_documents enable row level security;
revoke all on table public.shop_documents from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('shop-documents', 'shop-documents', false)
on conflict (id) do nothing;

-- ── 5. listings.shop_id ────────────────────────────────────────────────────
alter table public.listings
  add column if not exists shop_id uuid references public.shops(id) on delete set null;

create index if not exists listings_shop_idx
  on public.listings (shop_id, status)
  where shop_id is not null;

-- The catalogue reads listings column by column (0157); a shop's annonce may
-- say whose shop it is.
grant select (shop_id) on public.listings to anon, authenticated;

-- ── 6. The plans ───────────────────────────────────────────────────────────
insert into public.products (slug, kind, name_fr, name_ar, description, description_ar, price, listing_quota, duration_days, is_active, sort_order)
values
  ('pro-starter', 'subscription', 'Starter', 'ستارتر',
   'Une boutique, 10 annonces en ligne, les contacts de vos acheteurs.',
   'بوتيك، 10 إعلانات منشورة، واتصالات الشراة.',
   29, 10, 30, true, 50),
  ('pro-pro', 'subscription', 'Pro', 'برو',
   'Une boutique, 40 annonces en ligne, une équipe et les demandes qui vous correspondent.',
   'بوتيك، 40 إعلان منشور، فريق، والطلبات اللي تناسبك.',
   59, 40, 30, true, 51),
  ('pro-business', 'subscription', 'Business', 'بزنس',
   'Une boutique, 120 annonces en ligne, une équipe, vos projets et lotissements.',
   'بوتيك، 120 إعلان منشور، فريق، والمشاريع والتقسيمات متاعك.',
   119, 120, 30, true, 52)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
