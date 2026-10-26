-- ============================================================================
-- 0174 · Visit requests, and the Pro client pipeline
--
-- Cahier global V1, P3. Two steps after « afficher le numéro »:
--
-- 1. visit_requests — a signed-in buyer asks to see a property on one of up
--    to three half-days they propose. The seller (or, for a shop's annonce,
--    the shop's team) confirms one of them, declines, or later marks the
--    visit done; the buyer can cancel. Sending one shares the buyer's name
--    and number with the seller — the form says so — and nothing else does:
--    a phone reveal stays anonymous.
--      requested → confirmed | declined | cancelled
--      confirmed → done | cancelled
--    One open request per buyer and annonce.
-- 2. leads — a shop's clients, at a stage of the sale: new, contacted,
--    visit, negotiation, won, lost. A visit request on a shop's annonce
--    opens one; the team adds the others by hand (a walk-in, a call).
--
-- Server only (service role). Idempotent.
-- ============================================================================

-- ── 1. visit_requests ──────────────────────────────────────────────────────
create table if not exists public.visit_requests (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  buyer_id        uuid not null references public.profiles(id) on delete cascade,
  seller_id       uuid not null references public.profiles(id) on delete cascade,
  shop_id         uuid references public.shops(id) on delete set null,
  -- [{ "day": "2026-10-28", "part": "morning" | "afternoon" | "evening" }], 1 to 3
  slots           jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 3),
  buyer_name      text not null check (char_length(buyer_name) between 1 and 120),
  buyer_phone     text not null check (char_length(buyer_phone) between 8 and 24),
  message         text check (message is null or char_length(message) <= 600),
  status          text not null default 'requested'
                    check (status in ('requested', 'confirmed', 'declined', 'cancelled', 'done')),
  confirmed_slot  jsonb,
  seller_note     text check (seller_note is null or char_length(seller_note) <= 400),
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists visit_requests_open_once
  on public.visit_requests (listing_id, buyer_id)
  where status in ('requested', 'confirmed');
create index if not exists visit_requests_seller_idx on public.visit_requests (seller_id, created_at desc);
create index if not exists visit_requests_buyer_idx  on public.visit_requests (buyer_id, created_at desc);
create index if not exists visit_requests_shop_idx   on public.visit_requests (shop_id, created_at desc) where shop_id is not null;

drop trigger if exists _touch_visit_requests on public.visit_requests;
create trigger _touch_visit_requests before update on public.visit_requests
  for each row execute function public._touch_updated_at();

alter table public.visit_requests enable row level security;
revoke all on table public.visit_requests from anon, authenticated;

-- ── 2. leads ───────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id) on delete cascade,
  listing_id      uuid references public.listings(id) on delete set null,
  buyer_id        uuid references public.profiles(id) on delete set null,
  visit_id        uuid unique references public.visit_requests(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 120),
  phone           text check (phone is null or char_length(phone) <= 24),
  source          text not null check (source in ('visit', 'manual', 'suggestion')),
  stage           text not null default 'new'
                    check (stage in ('new', 'contacted', 'visit', 'negotiation', 'won', 'lost')),
  note            text check (note is null or char_length(note) <= 2000),
  next_action_at  timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_shop_idx on public.leads (shop_id, stage, updated_at desc);

drop trigger if exists _touch_leads on public.leads;
create trigger _touch_leads before update on public.leads
  for each row execute function public._touch_updated_at();

alter table public.leads enable row level security;
revoke all on table public.leads from anon, authenticated;
