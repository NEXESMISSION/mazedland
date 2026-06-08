-- ============================================================================
-- SECURITY / AUCTION INTEGRITY (CRITICAL) — stop sellers mutating their own
-- auction row directly via PostgREST.
--
-- 0001 created `auctions_owner_write FOR ALL` with using/with-check =
-- (is_admin() OR owner). FOR ALL includes UPDATE and DELETE, so a property
-- owner could PATCH their own auctions row through the authenticated client
-- and BYPASS the entire state machine — set status='ended_sold',
-- winner_user_id=<accomplice>, winner_amount, current_price, ends_at,
-- reserve_price, buy_now_price, or DELETE the row — none of which ever go
-- through place_bid / tick_auctions / close_* / cancel_auction_safe and their
-- gates (deposit, KYC, self-bid, reserve, anti-snipe, sixth-offer).
--
-- The app never uses that power: the ONLY client write to auctions is the
-- ScheduleForm INSERT (create a scheduled/live auction). Every state
-- transition is a SECURITY DEFINER RPC that bypasses RLS, so revoking the
-- owner's UPDATE/DELETE breaks nothing while closing the hole.
--
-- New policy set:
--   * auctions_owner_read   — owner reads own rows (any status, incl.
--                             cancelled) for their dashboard.
--   * auctions_owner_insert — owner creates an auction for their OWN property
--                             with a SAFE initial state (no pre-set winner /
--                             hammer / terminal status).
--   * auctions_admin_write  — admins keep full write for moderation.
--   * auctions_public_read  — unchanged (0001).
-- ============================================================================

drop policy if exists auctions_owner_write on public.auctions;

-- Owner can READ their own auctions in any status (public_read hides the
-- owner's own 'cancelled' rows; preserve dashboard visibility here).
drop policy if exists auctions_owner_read on public.auctions;
create policy auctions_owner_read on public.auctions
  for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and p.owner_id = auth.uid()
    )
  );

-- Owner can CREATE an auction for their own property, but only in a safe
-- initial state. No UPDATE/DELETE policy for owners — transitions run through
-- SECURITY DEFINER RPCs (place_bid, tick_auctions, close_auction_on_purchase,
-- cancel_auction_safe) which bypass RLS.
drop policy if exists auctions_owner_insert on public.auctions;
create policy auctions_owner_insert on public.auctions
  for insert
  with check (
    winner_user_id is null
    and winner_amount is null
    and hammer_at is null
    and status in ('scheduled', 'live')
    and exists (
      select 1 from public.properties p
      where p.id = property_id and p.owner_id = auth.uid()
    )
  );

-- Admins retain full write (moderation, manual correction).
drop policy if exists auctions_admin_write on public.auctions;
create policy auctions_admin_write on public.auctions
  for all
  using (public.is_admin())
  with check (public.is_admin());

notify pgrst, 'reload schema';
