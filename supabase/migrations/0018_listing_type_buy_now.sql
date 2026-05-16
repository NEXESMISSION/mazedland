-- ============================================================================
-- Batta.tn — two-path purchase: direct-sale listings + buy-now on auctions.
--
-- Mirrors mazed-auto's pattern adapted to real estate:
--
--   * Adds `listing_type` to auctions ('auction' | 'direct'). Direct
--     listings have a fixed `sale_price` and no bidding — first qualified
--     buyer wins. Existing rows default to 'auction'; nothing breaks.
--
--   * Adds `sale_negotiable` for direct listings — UI hint that the
--     seller is open to discussion. Pure presentational; no DB logic.
--
--   * Adds `buy_now_price` for auctions that want to offer an
--     "Acheter maintenant" escape hatch alongside bidding. Must exceed
--     opening_price (otherwise it's just bidding with extra steps).
--
--   * Extends `payment_kind` with the values needed for full-amount
--     purchases — `final_payment` (regular post-bid settlement) and
--     `buy_now` (one-shot purchase via buy-now or direct sale).
--
-- The atomic auction-close logic on a buy-now / direct-sale payment lives
-- in migration 0019.
-- ============================================================================

-- ─── 1. Auctions schema additions ───────────────────────────────────────────
-- `listing_type` is a TEXT + CHECK rather than an enum so we can extend it
-- (e.g. 'sealed_tender' or 'negotiation') without a multi-statement enum
-- migration; the constraint catches typos at insert time just the same.

alter table public.auctions
  add column if not exists listing_type text not null default 'auction';

do $$ begin
  alter table public.auctions
    add constraint listing_type_values
    check (listing_type in ('auction', 'direct'));
exception when duplicate_object then null; end $$;

alter table public.auctions
  add column if not exists sale_price       numeric(14,2),
  add column if not exists sale_negotiable  boolean not null default false,
  add column if not exists buy_now_price    numeric(14,2);

-- Direct listings need a sale price; auctions don't. Auctions can
-- optionally set a buy_now_price > opening_price.
do $$ begin
  alter table public.auctions
    add constraint sale_price_required_for_direct
    check (
      (listing_type = 'direct'  and sale_price is not null and sale_price > 0)
      or
      (listing_type = 'auction' and sale_price is null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.auctions
    add constraint buy_now_above_opening
    check (
      buy_now_price is null
      or buy_now_price > opening_price
    );
exception when duplicate_object then null; end $$;

-- Direct listings shouldn't expose a buy_now_price (it would be the
-- same as sale_price — confusing). Belt-and-braces guard.
do $$ begin
  alter table public.auctions
    add constraint buy_now_only_on_auctions
    check (
      listing_type = 'auction'
      or buy_now_price is null
    );
exception when duplicate_object then null; end $$;

create index if not exists auctions_listing_type_idx
  on public.auctions(listing_type);

-- ─── 2. payment_kind enum — add 'final_payment' and 'buy_now' ──────────────
-- Postgres ALTER TYPE ADD VALUE is non-transactional in older versions
-- and must run outside a transaction block. Supabase's CLI wraps each
-- migration in BEGIN/COMMIT, which conflicts — but `IF NOT EXISTS`
-- makes the operation safe to re-run and Postgres 12+ supports the
-- ADD VALUE inside a transaction so long as the new value isn't used
-- in the same transaction. We never read these values here, so it's safe.

alter type payment_kind add value if not exists 'final_payment';
alter type payment_kind add value if not exists 'buy_now';

notify pgrst, 'reload schema';
