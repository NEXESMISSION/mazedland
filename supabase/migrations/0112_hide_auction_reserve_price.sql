-- ============================================================================
-- AUCTION INTEGRITY / CONFIDENTIALITY (HIGH) — hide reserve_price from clients.
--
-- auctions_public_read (0001) returns EVERY column to anon/authenticated, and
-- there was no column-grant lockdown on public.auctions — so
--   GET /rest/v1/auctions?id=eq.<id>&select=reserve_price
-- returned the seller's SECRET reserve to any caller. A bidder who reads the
-- reserve can bid exactly at it, defeating the reserve mechanism (the seller
-- loses the above-reserve upside the secrecy is meant to create).
--
-- reserve_price is write-only from the client's side: ScheduleForm SETS it at
-- creation (INSERT, unaffected here), nothing in the UI ever displays it, and
-- only tick_auctions (SECURITY DEFINER → bypasses column grants) reads it to
-- decide ended_sold vs ended_unsold. So we revoke table-wide SELECT and re-grant
-- SELECT on every column EXCEPT reserve_price — same pattern 0083 used for
-- bids.ip_address/max_amount.
--
-- NOTE: new auctions columns added later need adding to this grant or they'll be
-- invisible to PostgREST `select=*` reads (the safe failure mode — omitted, not
-- leaked). The service-role client bypasses this, so server code that genuinely
-- needs reserve_price (tick) is unaffected; the cached public detail shell
-- (src/lib/auction/detail.ts) selects an explicit list that also omits it.
-- ============================================================================

revoke select on public.auctions from anon, authenticated;

grant select (
  id, property_id, type, opening_price,
  dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
  starts_at, ends_at, extend_window_seconds, extend_by_seconds,
  status, current_price, sixth_offer_deadline,
  winner_user_id, winner_amount, hammer_at, created_at, updated_at,
  listing_type, sale_price, sale_negotiable, buy_now_price,
  ending_24h_notified_at, ending_1h_notified_at,
  final_payment_due_at, final_payment_warn_7d_at, final_payment_warn_1d_at,
  final_payment_overdue_at, relisted_from_id, bid_count
) on public.auctions to anon, authenticated;

notify pgrst, 'reload schema';
