-- ============================================================================
-- Batta.tn — Pay-per-post: add listing_fee + buy_now + final_payment to the
-- payment_kind enum.
--
-- buy_now and final_payment were already used by code (see checkout flow)
-- but never declared in the enum. We add them here so the column accepts them
-- alongside the new listing_fee value introduced for the pay-per-post flow.
--
-- Standalone migration — Postgres rejects DDL that references a freshly added
-- enum value in the same transaction (e.g. an index predicate using the new
-- literal), so all dependent schema lives in 0026.
-- ============================================================================
alter type payment_kind add value if not exists 'buy_now';
alter type payment_kind add value if not exists 'final_payment';
alter type payment_kind add value if not exists 'listing_fee';
