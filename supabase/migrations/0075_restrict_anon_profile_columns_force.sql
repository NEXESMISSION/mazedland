-- ============================================================================
-- SECURITY (High) — B6, take 2. 0068 revoked SELECT on profiles from `anon`
-- and column-granted (id, full_name, role), but a live probe showed anon STILL
-- reading phone/kyc. That means the effective SELECT wasn't coming from a
-- direct `anon` grant — almost certainly it's granted to PUBLIC (every role),
-- so `revoke ... from anon` was a no-op.
--
-- Forceful fix:
--   1. Give `authenticated` an explicit full-table SELECT so revoking the
--      blanket PUBLIC grant can't strip a logged-in user's own-row read
--      (RLS still gates WHICH rows they see).
--   2. Revoke SELECT from BOTH anon and PUBLIC (kills the blanket grant).
--   3. Re-grant anon ONLY the three public columns the inspector/partner
--      embeds actually read.
-- After this, an anon `select=phone` must return 42501 permission denied.
-- ============================================================================

grant select on public.profiles to authenticated;

revoke select on public.profiles from anon;
revoke select on public.profiles from public;

grant select (id, full_name, role) on public.profiles to anon;

notify pgrst, 'reload schema';
