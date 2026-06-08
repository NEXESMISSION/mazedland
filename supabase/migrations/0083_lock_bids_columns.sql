-- ============================================================================
-- SECURITY (High) — stop the bids PII + proxy-ceiling leak.
--
-- bids_read (0001) is a ROW-level policy that returns the WHOLE row to anon/
-- authenticated for non-sealed (and closed sealed) auctions. RLS is not
-- column-level and nothing revoked the sensitive columns, so anyone could hit
--   GET /rest/v1/bids?auction_id=eq.<id>&select=bidder_id,max_amount,ip_address,device_hash
-- and harvest (a) every rival's secret proxy CEILING (max_amount) — letting
-- them snipe to exactly ceiling+increment and defeat proxy bidding — and
-- (b) every bidder's ip_address + device_hash (GDPR PII). The app client
-- carefully selected only safe columns, but that is cosmetic — the grant is
-- the boundary.
--
-- Fix (mirrors the 0080 profiles lockdown): revoke table SELECT from anon +
-- authenticated, re-grant ONLY the columns the bid history/leaderboard render.
-- place_bid is SECURITY DEFINER and admin/service-role bypass grants, so the
-- proxy-storing INSERT, admin reads, and the auction engine keep working.
--
-- NOTE (tracked): Supabase Realtime postgres_changes payloads are produced by
-- the replication role and include ALL columns regardless of these grants, so
-- a websocket subscriber to the bids channel can still observe max_amount/
-- ip_address in INSERT payloads. Fully closing that requires moving the live
-- feed to a server-authored broadcast (no per-row DB payload) — handled
-- separately. This migration closes the direct PostgREST query vector, which
-- is the bulk-harvestable one.
-- ============================================================================

revoke select on public.bids from anon, authenticated;
grant select (id, auction_id, bidder_id, amount, is_proxy, is_winning, placed_at)
  on public.bids to anon, authenticated;

notify pgrst, 'reload schema';
