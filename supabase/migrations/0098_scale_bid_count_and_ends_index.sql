-- ============================================================================
-- SCALABILITY — denormalize the per-auction bid count + add the ending-soon
-- composite index. (Evidence-backed scalability audit.)
--
-- 1. bid_count: the auction detail page AND the bid page each run
--    `select count(*) from bids where auction_id = $1` on EVERY viewer's
--    render (neither page is cached — they carry live state). On a popular
--    auction with thousands of bids viewed by many people, that exact count
--    is the hottest read in the system. Denormalize it onto auctions and
--    maintain it with a trigger on bids INSERT/DELETE so the pages read one
--    already-present integer instead of scanning the bids index per view.
--
--    A TRIGGER (not a place_bid edit) is deliberate: bids are only ever
--    inserted via place_bid, so the trigger captures every bid without
--    touching the money-critical RPC, and the increment runs on the auction
--    row place_bid already holds locked — no new contention.
--
-- 2. auctions(status, ends_at): the home "ending soon" rail filters
--    status IN (scheduled,live,extending) and ORDER BY ends_at — 0070 only
--    indexed (status, created_at) and (status, hammer_at), so that sort
--    falls back to a full sort of the live set. This composite serves the
--    filter + sort directly.
-- All idempotent.
-- ============================================================================

-- ── 1. bid_count ────────────────────────────────────────────────────────────
alter table public.auctions
  add column if not exists bid_count integer not null default 0;

-- Backfill from existing bids (idempotent — recomputes the true count).
update public.auctions a
   set bid_count = coalesce(sub.c, 0)
  from (
    select auction_id, count(*)::int as c
      from public.bids
     group by auction_id
  ) sub
 where sub.auction_id = a.id
   and a.bid_count is distinct from sub.c;

create or replace function public.bids_maintain_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.auctions
       set bid_count = bid_count + 1
     where id = new.auction_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.auctions
       set bid_count = greatest(bid_count - 1, 0)
     where id = old.auction_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists bids_maintain_count_trg on public.bids;
create trigger bids_maintain_count_trg
  after insert or delete on public.bids
  for each row execute function public.bids_maintain_count();

-- ── 2. ending-soon composite index ──────────────────────────────────────────
create index if not exists auctions_status_ends_idx
  on public.auctions (status, ends_at);

notify pgrst, 'reload schema';
