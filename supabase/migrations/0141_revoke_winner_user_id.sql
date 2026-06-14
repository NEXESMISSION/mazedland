-- ============================================================================
-- RLS / PRIVACY (audit #4 core, winner half) — stop exposing auctions.winner_user_id.
--
-- 0112 granted winner_user_id to anon/authenticated, so anyone could
-- `GET /rest/v1/auctions?select=winner_user_id&status=eq.ended_sold` and harvest
-- who won every lot, then resolve names. Revoke it. The readers are repointed:
--   - detail page already reads via getPublicAuctionDetail (SERVICE-ROLE cached
--     — keeps winner_user_id, unaffected);
--   - bid-page + checkout + the two admin pages switch their auction read to the
--     service-role client (public auction data; admin pages are is_admin-gated);
--   - account/activity drops winner_user_id from its selects and computes the
--     "won" flag via is_winner_of() below;
--   - the admin/deposits + manual-payment ROUTES already use service-role.
-- ============================================================================

-- Batch winner-self check: returns the subset of the given auction ids the
-- CALLER won. Lets account/activity show the user's own wins without reading the
-- raw winner_user_id column. (am_i_winner(uuid) from 0139 covers the single-lot
-- self-CTA on detail/bid/checkout when those don't already hold the column.)
create or replace function public.is_winner_of(p_ids uuid[])
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select a.id
  from public.auctions a
  where a.id = any(p_ids) and a.winner_user_id = auth.uid();
$$;

revoke all on function public.is_winner_of(uuid[]) from public, anon;
grant execute on function public.is_winner_of(uuid[]) to authenticated, service_role;

-- Re-grant the 0112 column list MINUS winner_user_id.
revoke select on public.auctions from anon, authenticated;
grant select (
  id, property_id, type, opening_price,
  dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
  starts_at, ends_at, extend_window_seconds, extend_by_seconds,
  status, current_price, sixth_offer_deadline,
  winner_amount, hammer_at, created_at, updated_at,
  listing_type, sale_price, sale_negotiable, buy_now_price,
  ending_24h_notified_at, ending_1h_notified_at,
  final_payment_due_at, final_payment_warn_7d_at, final_payment_warn_1d_at,
  final_payment_overdue_at, relisted_from_id, bid_count
) on public.auctions to anon, authenticated;

notify pgrst, 'reload schema';
