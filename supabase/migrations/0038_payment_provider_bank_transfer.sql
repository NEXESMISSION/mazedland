-- ============================================================================
-- Batta.tn — Add 'bank_transfer' to the payment_provider enum.
--
-- The app's manual payment flow offers two methods at checkout: "RIB / IBAN"
-- (provider = 'bank_transfer') and "Mobile money" (provider = 'd17'). The
-- enum shipped with 'd17' but never 'bank_transfer', so every bank-transfer
-- insert — listing fees, deposits, buy-now, generic payment initiation —
-- failed with `invalid input value for enum payment_provider: "bank_transfer"`
-- (HTTP 500). Adding the value unblocks the entire receipt-based flow.
-- ============================================================================

alter type public.payment_provider add value if not exists 'bank_transfer';

notify pgrst, 'reload schema';
