-- ============================================================================
-- SCALABILITY — indexes for hot filters/sorts that currently seq-scan.
-- (Deep-audit DB-index findings.) All idempotent.
--
-- NOTE: plain (non-CONCURRENT) CREATE INDEX takes a brief write lock on each
-- table. These tables are small pre-launch; if any has grown large in prod,
-- create these CONCURRENTLY out-of-band instead (can't run inside a txn).
-- ============================================================================

-- auction_deposits: /api/my-deposits fires on every logged-in visitor's first
-- paint of the (static) home page and filters user_id (+ active nulls); the
-- table only had auction_id. Partial index targets the exact "active deposits
-- for this user" predicate.
create index if not exists auction_deposits_user_active_idx
  on public.auction_deposits (user_id)
  where released_at is null and forfeited_at is null;
-- Broader user_id index for account/activity history (all of a user's rows).
create index if not exists auction_deposits_user_idx
  on public.auction_deposits (user_id);

-- notifications: the admin queue does a global ORDER BY created_at DESC + a
-- full count on the fastest-fan-out table, which had only (user_id, created_at)
-- composites — unusable for an unfiltered global sort.
create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

-- auctions feed: home/catalogue/explore filter status IN (...) then ORDER BY
-- created_at DESC (scheduled/live lists, explore) or hammer_at DESC (sold list
-- + monthly gte(hammer_at)). Only ends_at/status/property_id were indexed.
create index if not exists auctions_status_created_idx
  on public.auctions (status, created_at desc);
create index if not exists auctions_status_hammer_idx
  on public.auctions (status, hammer_at desc)
  where hammer_at is not null;

notify pgrst, 'reload schema';
