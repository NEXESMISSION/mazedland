-- ============================================================================
-- CONCURRENCY / MONEY (re-benchmark) — force payout status changes through the
-- advisory-locked RPC.
--
-- admin_set_payout_status (0059) takes a per-seller advisory lock and rechecks
-- the payable balance UNDER the lock before allowing 'paid', so two admins can't
-- over-pay off a stale balance. But the admin RLS write policy + table-level
-- UPDATE grant let an admin BYPASS it with a raw PostgREST
-- UPDATE seller_payouts SET status='paid' — skipping the lock + balance recheck.
--
-- Fix: revoke table UPDATE from authenticated/anon and re-grant UPDATE only on
-- the two claim columns (claimed_by, claimed_at) that the admin work-queue
-- "assigned-to-me" feature writes directly (src/lib/admin/claim.ts). Every
-- status/amount/notes transition must now go through admin_set_payout_status
-- (SECURITY DEFINER → runs as owner, unaffected by this column grant). Sellers
-- never UPDATE payouts (they INSERT via request_payout, revoked in 0103).
-- ============================================================================

revoke update on public.seller_payouts from authenticated, anon;
grant update (claimed_by, claimed_at) on public.seller_payouts to authenticated;

notify pgrst, 'reload schema';
