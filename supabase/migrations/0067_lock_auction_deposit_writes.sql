-- ============================================================================
-- SECURITY (High) — stop users forging a participation deposit.
--
-- The `deposits_self` policy (0001) was `for all` with
--   with check (auth.uid() = user_id or is_admin())
-- and no write grant revoke. So any KYC-verified user could POST a fake
-- auction_deposits row straight through PostgREST and satisfy place_bid's
-- "active deposit exists" gate WITHOUT paying — and could UPDATE
-- forfeited_at = null to escape a forfeit.
--
-- Legitimate deposit writes never come from a user-scoped client:
--   * free-entry deposits  → service-role insert (api/auctions/[id]/deposit)
--   * paid deposits        → _on_payment_captured trigger (SECURITY DEFINER)
--   * release/refund/forfeit → admin service-role routes (api/admin/deposits)
-- Service-role and SECURITY DEFINER owners bypass both grants and RLS, so
-- locking out `authenticated`/`anon` writes breaks nothing.
--
-- Defense in depth: revoke the write GRANTS *and* narrow the policy to
-- SELECT-only. Reads of one's own deposits (account pages, my-deposits) and
-- admin reads keep working.
-- ============================================================================

revoke insert, update, delete on public.auction_deposits from authenticated, anon;

drop policy if exists deposits_self on public.auction_deposits;
create policy deposits_self on public.auction_deposits for select
  using (auth.uid() = user_id or public.is_admin());

notify pgrst, 'reload schema';
