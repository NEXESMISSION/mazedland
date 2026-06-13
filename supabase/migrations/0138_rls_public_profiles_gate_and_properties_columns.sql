-- ============================================================================
-- RLS / PRIVACY (audit #24 + #12) — two safe, frontend-agnostic lockdowns.
--
-- #24 public_profiles: the view (security_invoker=false) let ANY authenticated
--     caller resolve the full_name of ANY user id via a blanket
--     `auth.uid() is not null`. Combined with readable bidder_id/winner_user_id
--     that is bulk de-anonymization. Tighten to RELATIONSHIP-SCOPED resolution:
--     a caller may resolve a name only for a public actor, a ready-lot seller,
--     an approved inspector, a bidder/winner on some lot, an inspection party,
--     or themselves. Anon behavior is UNCHANGED (it already saw only actors +
--     ready-sellers + approved inspectors). The view's columns ({id,full_name,
--     role}) and output shape are unchanged → no client changes; every current
--     usage (bid-history names, inspection counterparties, inspector grid) is
--     covered by a branch below.
--
-- #12 properties: properties had broad anon column access (RLS gated rows, but
--     no column lockdown), exposing owner_id (a person FK) + internal moderation
--     columns to anon. Mirror the 0112/0083 pattern: keep the FULL column set
--     for `authenticated` (RLS still gates WHICH rows; `properties(*)` embeds in
--     AUCTION_DETAIL_SELECT must keep resolving) and grant `anon` only the
--     public display columns — OMITTING owner_id, reviewed_by, rejection_reason,
--     reviewed_at, promo_manual, unscheduled_reminded_at. No app breakage: every
--     anon-facing property read goes through the service-role client (which
--     bypasses grants); there is no anon-direct browser read of properties.
--     address/lat/lng stay public on purpose (the public PropertyMap; the
--     real-estate skin likewise intends them public for `status='ready'` rows).
--
-- The bidder_id / winner_user_id raw-UUID lockdown (audit #4 core) is handled
-- separately — it needs a gated bid-history view + client/realtime repointing.
-- Idempotent.
-- ============================================================================

-- ── #24: relationship-scoped public_profiles ───────────────────────────────
drop view if exists public.public_profiles;
create view public.public_profiles
with (security_invoker = false) as
  select p.id, p.full_name, p.role
    from public.profiles p
   where
     -- Public-facing actors + ready-lot sellers + approved inspectors:
     -- resolvable by ANYONE incl. anon (unchanged from before).
     p.role in ('agency', 'bank', 'bailiff')
     or exists (select 1 from public.inspectors i where i.id = p.id and i.approved)
     or exists (select 1 from public.properties pr
                 where pr.owner_id = p.id and pr.status = 'ready')
     -- Authenticated callers: relationship-scoped only (was a blanket
     -- auth.uid() is not null). Covers the bid-history leaderboard, winners,
     -- inspection counterparties, and the caller's own name — but NOT arbitrary
     -- non-participants (which was pure identity harvesting).
     or (auth.uid() is not null and (
          p.id = auth.uid()
       or exists (select 1 from public.bids b where b.bidder_id = p.id)
       or exists (select 1 from public.auctions a where a.winner_user_id = p.id)
       or exists (select 1 from public.inspections ins
                   where ins.requested_by = p.id or ins.inspector_id = p.id)
     ));

grant select on public.public_profiles to anon, authenticated;

-- ── #12: properties column lockdown for anon ───────────────────────────────
revoke select on public.properties from anon, authenticated, public;
-- authenticated keeps the FULL column set; RLS (status='ready' OR owner OR
-- admin) still decides which rows, and properties(*) embeds keep resolving.
grant select on public.properties to authenticated;
-- anon: public display columns only — owner_id + internal moderation columns omitted.
grant select (
  id, title, description, type, area_sqm, rooms, bathrooms, floor, year_built,
  governorate, address, lat, lng, status, created_at, updated_at,
  promo_home_featured, promo_top_listed, promo_banner, promo_expires_at,
  listing_type, sale_price, sale_negotiable, attributes, search_text
) on public.properties to anon;

notify pgrst, 'reload schema';
