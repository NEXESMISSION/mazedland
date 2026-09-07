-- ============================================================================
-- PIVOT PHASE 5 — the plumbing a public annonce page needs.
--
-- 0146 built `listings` and 0147 filled it with 29 rows, but the only public
-- surface is `/annonces`, a list. There is no page to open. Everything below
-- exists so that page can be written:
--
--   contact_reveals   the phone number is not in the HTML, and cannot be:
--                     0146 grants `contact_phone` to service_role alone. It is
--                     fetched on a click, and that click is logged and
--                     rate-limited. A scraper that fetches a thousand annonce
--                     pages gets a thousand pages with no numbers in them.
--   watchlist.listing_id   the heart on a card had nowhere to write: the table
--                     is keyed to auction_id, and auctions are the product
--                     being retired.
--   listing_views     `listings.view_count` has existed since 0146 and nothing
--                     has ever written to it. Every annonce reports zero views,
--                     so an admin cannot tell one nobody opened from one fifty
--                     people opened and none of them called — the difference
--                     between "lower the price" and "the photos are bad".
--   listings.reference   BT-00042. Property is sold over the telephone here.
--                     Nobody reads a uuid down a phone line, and "S+2 Marsa"
--                     is not a unique title.
--
-- Ported from Mazed Auto's 0154 / 0163 / 0166 / 0173 / 0175, collapsed into one
-- migration because on this project they arrive together.
-- ============================================================================

-- ── Who asked for a phone number ────────────────────────────────────────────
create table if not exists public.contact_reveals (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists contact_reveals_listing_idx on public.contact_reveals(listing_id, created_at desc);
create index if not exists contact_reveals_ip_idx      on public.contact_reveals(ip_hash, created_at desc);

alter table public.contact_reveals enable row level security;

drop policy if exists contact_reveals_admin_read on public.contact_reveals;
create policy contact_reveals_admin_read on public.contact_reveals
  for select to authenticated using (public.is_admin());

grant all on public.contact_reveals to service_role;

-- One statement, no race. A read-modify-write from the app looks fine and
-- silently loses counts under concurrency.
create or replace function public.increment_contact_reveals(p_listing uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update public.listings
     set contact_reveal_count = contact_reveal_count + 1
   where id = p_listing
  returning contact_reveal_count;
$$;

revoke all on function public.increment_contact_reveals(uuid) from public, anon, authenticated;
grant execute on function public.increment_contact_reveals(uuid) to service_role;

-- ── Favourites follow the catalogue ─────────────────────────────────────────
-- Both columns nullable, exactly one set. Auction rows keep watching their lot
-- until that product is gone; catalogue rows point at a listing.
alter table public.watchlist
  add column if not exists listing_id uuid references public.listings(id) on delete cascade;

-- The old primary key required auction_id to be present, which is precisely
-- the assumption being removed.
do $$
declare v_pk text;
begin
  select conname into v_pk
    from pg_constraint
   where conrelid = 'public.watchlist'::regclass and contype = 'p';
  if v_pk is not null then
    execute format('alter table public.watchlist drop constraint %I', v_pk);
  end if;
end $$;

alter table public.watchlist alter column auction_id drop not null;

alter table public.watchlist
  add column if not exists id uuid primary key default gen_random_uuid();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'watchlist_one_subject') then
    alter table public.watchlist
      add constraint watchlist_one_subject
      check (num_nonnulls(auction_id, listing_id) = 1);
  end if;
end $$;

-- "Saved twice" stays impossible on either subject.
create unique index if not exists watchlist_user_auction_uniq
  on public.watchlist(user_id, auction_id) where auction_id is not null;
create unique index if not exists watchlist_user_listing_uniq
  on public.watchlist(user_id, listing_id) where listing_id is not null;
create index if not exists watchlist_listing_idx on public.watchlist(listing_id);

-- ── Who looked, how often ───────────────────────────────────────────────────
--
-- One row per (listing, viewer), not one per page load:
--   unique viewers = count(*), total views = sum(view_count),
--   returning = count(view_count > 1).
--
-- A viewer is a signed-in user where we have one and a salted IP hash where we
-- do not — most buyers browse a property catalogue without an account, and
-- requiring a user_id would throw nearly all of the data away.
--
-- A RETURN VISIT IS NOT A REFRESH. Reloading, or bouncing back from the photo
-- carousel, must not read as fresh interest; a repeat only counts after 30
-- minutes. The seller's own visits are not counted at all — otherwise a seller
-- refreshing their own ad is its best audience.
create table if not exists public.listing_views (
  listing_id    uuid not null references public.listings(id) on delete cascade,
  -- 'u:<user uuid>' signed in, 'a:<salted ip hash>' not. Prefixed so the two
  -- spaces cannot collide and a row's kind is readable.
  viewer_key    text not null,
  user_id       uuid references public.profiles(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  view_count    int not null default 1,
  primary key (listing_id, viewer_key)
);

create index if not exists listing_views_listing_idx
  on public.listing_views (listing_id, last_seen_at desc);
create index if not exists listing_views_recent_idx
  on public.listing_views (last_seen_at desc);
create index if not exists listing_views_user_idx
  on public.listing_views (user_id) where user_id is not null;

alter table public.listing_views enable row level security;

drop policy if exists listing_views_admin_read on public.listing_views;
create policy listing_views_admin_read on public.listing_views
  for select to authenticated using (public.is_admin());

grant all on public.listing_views to service_role;

create or replace function public.record_listing_view(
  p_listing    uuid,
  p_viewer_key text,
  p_user       uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_seller    uuid;
  v_prev_seen timestamptz;
  v_new_visit boolean;
begin
  if p_listing is null or coalesce(p_viewer_key, '') = '' then
    return;
  end if;

  select seller_id into v_seller from public.listings where id = p_listing;
  if v_seller is null then
    return;                                   -- listing deleted mid-request
  end if;
  if p_user is not null and p_user = v_seller then
    return;                                   -- a seller is not their own audience
  end if;

  select last_seen_at into v_prev_seen
    from public.listing_views
   where listing_id = p_listing and viewer_key = p_viewer_key;

  v_new_visit := v_prev_seen is null or v_prev_seen < v_now - interval '30 minutes';

  insert into public.listing_views as lv
         (listing_id, viewer_key, user_id, first_seen_at, last_seen_at, view_count)
  values (p_listing, p_viewer_key, p_user, v_now, v_now, 1)
  on conflict (listing_id, viewer_key) do update
     set last_seen_at = v_now,
         -- A viewer who signs in later stops being anonymous to us.
         user_id      = coalesce(lv.user_id, excluded.user_id),
         view_count   = lv.view_count + case when v_new_visit then 1 else 0 end;

  if v_new_visit then
    update public.listings set view_count = view_count + 1 where id = p_listing;
  end if;
end;
$$;

revoke all on function public.record_listing_view(uuid, text, uuid) from public;
grant execute on function public.record_listing_view(uuid, text, uuid) to service_role;

-- Views, favourites and reveals live in three tables; the admin wants them on
-- one line, so the join is written once here rather than in a page.
create or replace view public.listing_analytics as
select
  l.id                                  as listing_id,
  coalesce(v.unique_viewers, 0)::int    as unique_viewers,
  coalesce(v.total_views, 0)::int       as total_views,
  coalesce(v.returning_viewers, 0)::int as returning_viewers,
  v.last_view_at,
  coalesce(f.favourites, 0)::int        as favourites,
  coalesce(r.reveals, 0)::int           as reveals,
  coalesce(r.unique_revealers, 0)::int  as unique_revealers
from public.listings l
left join (
  select listing_id,
         count(*)                               as unique_viewers,
         sum(view_count)                        as total_views,
         count(*) filter (where view_count > 1) as returning_viewers,
         max(last_seen_at)                      as last_view_at
    from public.listing_views
   group by listing_id
) v on v.listing_id = l.id
left join (
  select listing_id, count(*) as favourites
    from public.watchlist
   where listing_id is not null
   group by listing_id
) f on f.listing_id = l.id
left join (
  select listing_id,
         count(*)                                         as reveals,
         count(distinct coalesce(user_id::text, ip_hash)) as unique_revealers
    from public.contact_reveals
   group by listing_id
) r on r.listing_id = l.id;

-- security_invoker so the view carries the CALLER's permissions, not its
-- owner's: it must never become a way to read these tables without rights.
alter view public.listing_analytics set (security_invoker = on);

grant select on public.listing_analytics to service_role;

-- ── A reference you can say out loud ────────────────────────────────────────
-- BT-00042. Five digits, sortable, short enough to write on a receipt or read
-- to a caller. Generated by a BEFORE INSERT trigger rather than a DEFAULT so an
-- explicit value (an import, a restore) is respected instead of overwritten,
-- and so the sequence is consumed only when it is actually used.
create sequence if not exists public.listing_reference_seq as bigint start 1;

create or replace function public.listing_reference_next()
returns text
language sql
volatile
set search_path = public
as $$
  select 'BT-' || lpad(nextval('public.listing_reference_seq')::text, 5, '0');
$$;

alter table public.listings
  add column if not exists reference text;

-- Backfill in creation order, so the oldest annonce is BT-00001 and the numbers
-- say something about age.
do $$
declare r record;
begin
  for r in select id from public.listings where reference is null order by created_at, id loop
    update public.listings set reference = public.listing_reference_next() where id = r.id;
  end loop;
end $$;

create or replace function public.listings_set_reference()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := public.listing_reference_next();
  end if;
  return new;
end;
$$;

drop trigger if exists set_listing_reference on public.listings;
create trigger set_listing_reference
  before insert on public.listings
  for each row execute function public.listings_set_reference();

create unique index if not exists listings_reference_uniq
  on public.listings (reference);

alter table public.listings
  alter column reference set not null;

comment on column public.listings.reference is
  'Human-readable public reference (BT-00042). Shown on the annonce and searchable in the admin.';

-- The reference is public: it is printed on the page. Added to the existing
-- column grant from 0146, which deliberately withholds contact_phone.
grant select (reference) on public.listings to anon, authenticated;

notify pgrst, 'reload schema';
