-- ============================================================================
-- PAYMENTS — allow up to 3 receipt images per payment.
--
-- Buyers often have more than one proof of a single transfer (the bank order +
-- the confirmation SMS/screenshot, or a multi-page deposit slip). The receipt
-- upload stored a single `receipt_url`. Add `receipt_urls text[]` for the full
-- set; the receipt route keeps `receipt_url` populated with the FIRST image so
-- every existing display (admin queue, reject page, account/payments, deposits,
-- listing-fee) keeps working with zero change, while surfaces that want all
-- images read `receipt_urls` (falling back to `[receipt_url]` for old rows).
--
-- payments has table-level SELECT grants (not column-locked like auctions/bids),
-- so the new column is covered automatically — no per-column grant needed.
-- Idempotent.
-- ============================================================================

alter table public.payments
  add column if not exists receipt_urls text[];

notify pgrst, 'reload schema';
