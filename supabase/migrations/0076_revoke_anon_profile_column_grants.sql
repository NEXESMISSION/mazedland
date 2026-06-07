-- ============================================================================
-- SECURITY (High) — B6, the REAL fix. Live grant diagnostic revealed why 0068
-- and 0075 didn't stop the anon phone scrape: `anon` holds EXPLICIT
-- column-level SELECT grants on EVERY column of profiles (phone, kyc_status,
-- trust_score, governorate, …). A table-level `REVOKE SELECT ON profiles FROM
-- anon` does NOT remove column-level grants — so anon kept reading phone.
--
-- Fix: revoke SELECT on every currently-granted column from anon, then grant
-- back ONLY the three the public inspector/partner embeds need. After this an
-- anon `select=phone` must return 42501.
-- ============================================================================

revoke select (
  id, full_name, role, phone, kyc_status, trust_score, governorate,
  is_diaspora, language, kyc_submitted_at, kyc_verified_at,
  kyc_pending_reminded_at, created_at, updated_at, deleted_at
) on public.profiles from anon;

grant select (id, full_name, role) on public.profiles to anon;

notify pgrst, 'reload schema';
