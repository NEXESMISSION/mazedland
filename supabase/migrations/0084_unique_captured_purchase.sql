-- ============================================================================
-- MONEY (High) — prevent double-credit of a sale.
--
-- The only uniqueness on payments is PARTIAL indexes limited to
-- status in ('pending','pending_review') (0041). Nothing stops TWO 'captured'
-- rows of the same (user_id, auction_id, kind). seller_earnings (0043/0073)
-- sums every captured buy_now/final_payment with no de-dup, so two captured
-- rows for one sale credit the seller twice and charge the buyer twice in
-- their history. The realistic trigger: a buyer's online buy_now/final_payment
-- is approved AND an admin also records the "cash received" via manual-payment
-- — close_auction_on_purchase no-ops the second (already_closed) so nothing
-- visibly errors while the ledger silently inflates.
--
-- Fix: a partial UNIQUE index so a second captured purchase row of the same
-- kind for the same user+auction fails atomically, regardless of which route
-- (online capture, admin PATCH, or manual-payment) attempts it. The
-- manual-payment route also gets an explicit pre-check (separate change) for a
-- friendly 409 instead of a raw constraint error.
--
-- deposit_lock is intentionally NOT covered here: a winner's deposit_lock and
-- their final_payment are different kinds, and deposit dedup is already handled
-- by auction_deposits (one active row per auction+user).
-- ============================================================================

create unique index if not exists payments_one_captured_purchase
  on public.payments (user_id, auction_id, kind)
  where status = 'captured' and kind in ('buy_now', 'final_payment');

notify pgrst, 'reload schema';
