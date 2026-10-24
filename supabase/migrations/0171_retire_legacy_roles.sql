-- ============================================================================
-- 0171 · Retire the auction roles: bank, bailiff, inspector
--
-- They were the auction product's roles (lots, cautions, inspections), gone
-- with it. The six accounts still carrying them are the seed accounts of
-- 2026-05-15 (@mazedimmo.test), each the seller of one catalogue annonce:
-- they become ordinary sellers and keep their annonces. Decided by the owner
-- on 2026-10-24.
--
-- The enum values stay. Removing a value from a Postgres enum means
-- rebuilding the type under every policy and function that reads it, for no
-- gain: nothing can assign them any more (the console's role routes accept
-- individual, agency and admin only).
--
-- The profile guard (_guard_profile_self_update) refuses a role change
-- outside an admin session; this uses its transaction-local bypass, as the
-- trusted server triggers do. Idempotent.
-- ============================================================================

select set_config('app.bypass_profile_guard', 'on', true);

update public.profiles
   set role = 'individual'
 where role in ('bank', 'bailiff', 'inspector');
