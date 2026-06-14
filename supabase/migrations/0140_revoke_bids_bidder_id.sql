-- ============================================================================
-- RLS / PRIVACY (audit #4 core, 2/2) — stop exposing raw bids.bidder_id.
--
-- 0139 added the gated auction_bids_public view (amount/time + relationship-
-- scoped bidder_name + is_mine, no raw id) and the client was repointed to it:
--   - bid-page SSR + BidHistoryRealtime read the view (names + is_mine);
--   - account/activity + AuctionEndModal read own bids via is_mine;
--   - RecentBidsFeed already uses the service-role client (unaffected).
-- So NO browser/SSR code reads bids.bidder_id anymore. Revoke the column from
-- anon/authenticated so the raw bidder UUID can't be bulk-harvested across lots
-- and joined to names — closing the bidder de-anonymization.
--
-- Safe: place_bid + close_auction_on_purchase are SECURITY DEFINER (run as
-- owner, unaffected by column grants); the bids_read / bids_insert_self RLS
-- policies reference bidder_id, but policy expressions are evaluated by the
-- system and are NOT gated by the caller's column privileges. service_role keeps
-- ALL columns (0133). Mirrors the 0083 grant list, minus bidder_id.
-- ============================================================================

revoke select on public.bids from anon, authenticated;
grant select (id, auction_id, amount, is_proxy, is_winning, placed_at)
  on public.bids to anon, authenticated;

notify pgrst, 'reload schema';
