-- ============================================================================
-- Watchlist — let bidders save auctions to follow without being a bidder.
-- Closes audit gap #12: the bottom-tab "Watchlist" surface had no backing
-- store and the heart button on PropertyCard didn't exist.
--
-- Rows are scoped per user; a user can save the same auction at most once.
-- We point at auction_id (not property_id) so a "saved" item disappears
-- naturally when the auction ends + is archived; the same property can
-- appear again under a fresh auction without polluting old saves.
-- ============================================================================

create table if not exists public.watchlist (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, auction_id)
);
create index if not exists watchlist_user_idx on public.watchlist(user_id, created_at desc);
create index if not exists watchlist_auction_idx on public.watchlist(auction_id);

alter table public.watchlist enable row level security;

-- Owner-only: a user can read and write their own saves; admins can read
-- everything for ops but never write on someone else's behalf.
drop policy if exists watchlist_self_read on public.watchlist;
create policy watchlist_self_read on public.watchlist for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists watchlist_self_insert on public.watchlist;
create policy watchlist_self_insert on public.watchlist for insert
  with check (auth.uid() = user_id);

drop policy if exists watchlist_self_delete on public.watchlist;
create policy watchlist_self_delete on public.watchlist for delete
  using (auth.uid() = user_id);

-- Public counter: an auction's total watchers is non-sensitive social
-- proof we want to render on the property card. Expose it via a view
-- so anonymous reads can hit a single column without seeing other rows.
create or replace view public.auction_watcher_counts as
select auction_id, count(*)::int as watchers
from public.watchlist
group by auction_id;

grant select on public.auction_watcher_counts to anon, authenticated;

notify pgrst, 'reload schema';
