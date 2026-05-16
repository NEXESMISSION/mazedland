-- ============================================================================
-- Public bid-count view — closes audit gap #29.
--
-- The bids RLS hides other users' rows on a live sealed-bid auction so
-- amounts stay private. As a side effect the front-end currently looks
-- empty ("no one else is bidding"), which discourages would-be bidders.
-- Expose a non-sensitive count per auction via a view so the UI can
-- render "X bids placed" without revealing who or for how much.
-- ============================================================================

create or replace view public.auction_bid_counts as
select auction_id, count(*)::int as total_bids
from public.bids
group by auction_id;

grant select on public.auction_bid_counts to anon, authenticated;

notify pgrst, 'reload schema';
