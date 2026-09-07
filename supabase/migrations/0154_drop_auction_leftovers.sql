-- ============================================================================
-- PIVOT PHASE 6 (2/2) — what 0153 left behind.
--
-- Verifying 0153 against the live schema afterwards found two kinds of
-- leftover, both worth naming because both are easy to repeat:
--
-- 1. `bid_events` — an auction table I simply did not have on the list. It
--    survived because nothing pointed at it: no foreign key INTO it, no view
--    over it, so every dependency scan came back clean. The only thing that
--    found it was listing the columns still called `auction_id` after the drop.
--
-- 2. Six functions that 0153 tried to drop and silently did not:
--    accept_listing_payment, admin_payment_boxes, cancel_auction_safe,
--    is_winner_of, place_bid, review_kyc. `drop function if exists f(a, b)`
--    matches on the ARGUMENT LIST, and `if exists` turns a signature that does
--    not match into a no-op instead of an error — so a guessed signature
--    reports success and drops nothing.
--
--    The fix is `drop routine` selected from the catalogue by NAME, which takes
--    every overload and cannot be defeated by a wrong argument list.
-- ============================================================================

-- ── The table the scans could not see ───────────────────────────────────────
drop table if exists public.bid_events cascade;

-- ── The functions that outlived their own drop statements ───────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         -- Auction machinery.
         'accept_listing_payment', 'cancel_auction_safe', 'is_winner_of',
         'place_bid', 'am_i_winner', 'place_sixth_offer',
         'close_auction_on_purchase', 'tick_auctions', 'tick_auctions_cron',
         'process_bid_events', 'bids_maintain_count', 'reverse_settlement',
         'process_final_payment_defaults', 'notify_final_payment_due',
         'notify_final_payment_due_cron', 'notify_auctions_ending_soon',
         'notify_auctions_ending_soon_cron', 'notify_unscheduled_listings',
         -- The old admin payments screen, which grouped receipts by auction.
         'admin_payment_boxes',
         -- Identity verification and the inspector network.
         'review_kyc', 'admin_approve_inspector', 'get_inspection_contact',
         -- Payouts.
         'seller_balance', 'seller_earnings', 'request_payout',
         'admin_set_payout_status',
         -- Property-era promotions.
         'expire_listing_promotions'
       ])
  loop
    execute format('drop routine if exists %s cascade', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
