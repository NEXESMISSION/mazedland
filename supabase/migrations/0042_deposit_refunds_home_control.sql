-- ============================================================================
-- Batta.tn — Deposit refund tracking + manual home curation.
--
-- 1) auction_deposits gains a refund record so the team can manage the
--    money-back-to-losers step after an auction ends (it was untracked, the
--    "I get lost" problem). Lifecycle is derived from the timestamps:
--      locked      → released_at IS NULL  AND forfeited_at IS NULL AND refunded_at IS NULL
--      to refund   → released_at NOT NULL AND refunded_at IS NULL  AND forfeited_at IS NULL
--      refunded    → refunded_at NOT NULL
--      forfeited   → forfeited_at NOT NULL
--
-- 2) properties.promo_manual flags a home placement set by an admin (free
--    curation) vs one paid for via a listing-fee promo — so /admin/home can
--    show "Payé" vs "Manuel".
-- ============================================================================

alter table public.auction_deposits
  add column if not exists refunded_at  timestamptz,
  add column if not exists refund_ref   text,
  add column if not exists refunded_by  uuid references public.profiles(id) on delete set null;

alter table public.properties
  add column if not exists promo_manual boolean not null default false;

notify pgrst, 'reload schema';
