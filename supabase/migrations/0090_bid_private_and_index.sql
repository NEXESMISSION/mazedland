-- ============================================================================
-- SECURITY/SCALE — sibling table for sensitive bid fields + hot top-bid index.
--
-- (1) bid_private: Supabase Realtime postgres_changes payloads are produced by
-- the replication role and carry EVERY column of the changed row regardless of
-- the 0083 column grants. The live leaderboard subscribes to `bids` INSERTs, so
-- ip_address + max_amount (the rival's secret proxy ceiling) streamed to every
-- subscriber. Fix: keep those fields on a SEPARATE table that is NOT in the
-- realtime publication; place_bid (0091) writes them here instead of on bids,
-- so the published bids row carries NULL for them and the websocket payload
-- leaks nothing. RLS-on / no policies → only SECURITY DEFINER funcs +
-- service-role (admin fraud views) read it.
--
-- (2) bids_auction_amount_idx: place_bid's English top-bid lookup
-- (ORDER BY amount DESC, placed_at ASC) ran inside the FOR UPDATE lock with no
-- supporting index (only (auction_id, placed_at) existed) → an in-lock top-N
-- heapsort whose cost grows with bid count on a hot lot. This index makes it an
-- index-first-row read; it also speeds the identical sorts in tick_auctions /
-- sixth-offer / relist.
-- ============================================================================

create table if not exists public.bid_private (
  bid_id      uuid primary key references public.bids(id) on delete cascade,
  ip_address  inet,
  max_amount  numeric(14,2),
  device_hash text,
  created_at  timestamptz not null default now()
);
alter table public.bid_private enable row level security;
-- No policies → not reachable by anon/authenticated; definer funcs +
-- service_role only (RLS does not apply to the table owner / service role).

create index if not exists bids_auction_amount_idx
  on public.bids (auction_id, amount desc, placed_at asc);

notify pgrst, 'reload schema';
