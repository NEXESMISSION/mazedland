-- ============================================================================
-- AUTH (audit #2) — server-checkable phone-verification proof.
--
-- The phone-OTP gate was enforced ONLY in the client signup form, and the form
-- was fail-open (any send/verify hiccup created the account anyway); /api/auth/
-- signup never checked verification at all. A script could POST straight to the
-- route and register ANY phone → mass fake accounts / phone-number squatting.
--
-- Fix: /api/auth/phone/verify now STAMPS verified_at (and clears the code)
-- instead of deleting the row, and /api/auth/signup requires a recent
-- verified_at WHEN SMS is configured (fail closed) — see the route changes.
-- This column is the durable proof those routes read.
--
-- SMS is not wired yet (isSmsConfigured()===false), so today signup still
-- proceeds without a proof — acceptable until SMS is enabled, at which point
-- the gate is automatically enforced. Idempotent.
-- ============================================================================

alter table public.phone_otps add column if not exists verified_at timestamptz;

notify pgrst, 'reload schema';
