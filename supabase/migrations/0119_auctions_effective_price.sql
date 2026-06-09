-- ============================================================================
-- READ/BROWSE SCALABILITY + price-filter CORRECTNESS.
--
-- The explore/catalogue price filter used
--   or(current_price.gte.X, sale_price.gte.X, opening_price.gte.X)
-- which is both slow and WRONG:
--   * OR across three columns can't use a single index → bitmap/seq scan on
--     every cache-miss; under diverse filter combos at scale that's the slowest
--     browse query.
--   * Semantically broken: a live English lot bid up to 200k still matched a
--     "max 100k" filter because its 50k opening_price satisfied the OR. Buyers
--     saw lots far outside their budget.
--
-- Fix: a single coalesced effective_price = the price actually shown on the card
--   coalesce(current_price, sale_price, opening_price)
--     - live English/sealed → current_price (once bidding starts, else opening)
--     - direct sale          → sale_price
--     - scheduled, no bids    → opening_price
-- Stored + indexed so the range filter is index-driven and correct. The explore
-- route + catalogue page switch their .or() blocks to .gte/.lte on this column.
--
-- effective_price is derived purely from already-public price columns, so it is
-- NOT sensitive. 0112 locked auctions to an explicit per-column SELECT grant;
-- add this new column to that grant so PostgREST select=* still sees it (the
-- service-role explore client bypasses the grant regardless). reserve_price
-- stays excluded.
-- ============================================================================

alter table public.auctions
  add column if not exists effective_price numeric
  generated always as (coalesce(current_price, sale_price, opening_price)) stored;

create index if not exists auctions_effective_price_idx
  on public.auctions (effective_price);

grant select (effective_price) on public.auctions to anon, authenticated;

notify pgrst, 'reload schema';
