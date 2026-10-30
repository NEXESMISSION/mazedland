-- ============================================================================
-- 0190 · The two admin accounts that could not sign in: legacy 8-digit phones.
--
-- Sign-in (/api/auth/login-by-phone) and password reset (/api/auth/reset-
-- password) look an account up by its phone in E.164, « +216 » + 8 digits, with
-- an exact `.eq("phone", …)`. 0134 normalised the rows that held separators
-- (« +216 22 111 222 »), but two accounts created in May 2026 hold the bare
-- national number — « 58415500 », « 53518337 » — which that lookup can never
-- match: every sign-in answered « Identifiants invalides » whatever the
-- password, and the SMS reset answered « no account » (the owner, 2026-10-30).
--
-- A Tunisian number is 8 digits; the same number with « +216 » in front is its
-- E.164 form. A row is left alone when that form already belongs to another
-- profile (the unique index from 0134 would refuse it, and that is a human
-- decision). Idempotent: a second run touches nothing.
--
-- Both rows are admins, and the profile guard (0178) keeps an admin's row for a
-- signed-in full admin; a migration has no session, so it uses the guard's own
-- transaction-local bypass (the way 0017 seeded the first admin). Only `phone`
-- is written.
-- ============================================================================

select set_config('app.bypass_profile_guard', 'on', true);

update public.profiles p
set phone = '+216' || p.phone
where p.phone ~ '^[0-9]{8}$'
  and not exists (
    select 1 from public.profiles q where q.phone = '+216' || p.phone
  );

select set_config('app.bypass_profile_guard', 'off', true);

notify pgrst, 'reload schema';
