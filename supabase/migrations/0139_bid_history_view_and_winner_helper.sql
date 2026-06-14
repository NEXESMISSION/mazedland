-- ============================================================================
-- RLS / PRIVACY (audit #4 core) — DB FOUNDATION for the bidder/winner
-- de-anonymization fix. ADDITIVE ONLY: creates a gated bid-history view + a
-- winner-self helper. It changes NO existing behavior and revokes NOTHING yet
-- (the bidder_id / winner_user_id column revokes are a follow-up that must land
-- TOGETHER with the client repoint + a bid-room verification). Shipping the
-- foundation first lets the repoint be a contained, verifiable next step.
--
-- The leak: bids.bidder_id + auctions.winner_user_id are column-readable by any
-- anon/authenticated caller, and public_profiles resolves ids to names → bulk
-- cross-lot de-anonymization. The intended UI feature is per-lot bidder NAMES
-- on the leaderboard, not raw UUIDs — so the fix is to serve bid history through
-- a view that exposes a masked name + an is_mine flag and never the raw id.
-- ============================================================================

-- Gated public bid history. security_invoker=false → runs as owner (bypasses
-- bids RLS), so we REPLICATE the bids_read sealed gate (0001:467-479) exactly in
-- the WHERE, and resolve the name through public_profiles (which carries the
-- 0138 relationship-scoped gate — so anon still only sees actor/seller names,
-- authenticated sees bidder/winner names, nobody gets the raw bidder_id).
create or replace view public.auction_bids_public
with (security_invoker = false) as
  select
    b.id,
    b.auction_id,
    b.amount,
    b.is_proxy,
    b.is_winning,
    b.placed_at,
    (select pp.full_name from public.public_profiles pp where pp.id = b.bidder_id) as bidder_name,
    (b.bidder_id = auth.uid()) as is_mine
  from public.bids b
  where public.is_admin()
     or auth.uid() = b.bidder_id
     or exists (
       select 1 from public.auctions a
       where a.id = b.auction_id
         and (a.type <> 'sealed'
              or a.status in ('ended_sold', 'ended_unsold', 'sixth_offer_window', 'awarded'))
     );

grant select on public.auction_bids_public to anon, authenticated;

-- Winner-self helper — lets the detail/bid/checkout pages render the winner's
-- own "pay final balance" CTA without selecting the raw winner_user_id column
-- (so that column can later be revoked from anon/authenticated). Returns a plain
-- boolean about the CALLER; no identity leaks.
create or replace function public.am_i_winner(p_auction_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id and a.winner_user_id = auth.uid()
  );
$$;

revoke all on function public.am_i_winner(uuid) from public, anon;
grant execute on function public.am_i_winner(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
