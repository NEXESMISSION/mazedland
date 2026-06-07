-- ============================================================================
-- SECURITY (Critical) — close the anonymous full-admin takeover.
--
-- Regression history: 0006 hardcoded the signup role to 'individual' and
-- removed the auth.users.raw_app_meta_data 'admin' mirror. 0031 and then
-- 0045 (while threading `governorate`/`phone` through the trigger)
-- REINTRODUCED the original flaw: they coalesced the CLIENT-SUPPLIED
-- `role` out of signup metadata into profiles.role AND mirrored 'admin'
-- into the JWT app_metadata. That let anyone call
--   supabase.auth.signUp({ options:{ data:{ role:'admin' }}})
-- and become full platform admin (passes requireAdmin() which reads
-- profiles.role AND every is_admin() RLS/RPC gate which reads the JWT claim).
--
-- This migration restores 0006's hardening while KEEPING the legitimate
-- 0045 additions (phone + governorate threading):
--   * role is HARDCODED to 'individual'::user_role — never read from metadata
--   * the raw_app_meta_data 'admin' mirror block is gone
-- Role elevation stays admin-only (inspector approval, partner onboarding)
-- through service-role flows, guarded after-the-fact by
-- _guard_profile_self_update (0006), which already blocks a user from
-- changing their own role/kyc_status.
--
-- Idempotent (create or replace), safe to re-run.
-- ============================================================================

create or replace function public._on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, language, governorate)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'phone', null),
    -- HARDCODED: never trust client metadata for role (re-fix of 0006 C1).
    'individual'::user_role,
    coalesce(new.raw_user_meta_data ->> 'language', 'ar'),
    coalesce(new.raw_user_meta_data ->> 'governorate', null)
  )
  on conflict (id) do nothing;

  -- NOTE: the 0045 `if role = 'admin' then update auth.users ...` mirror
  -- block is deliberately NOT recreated. The JWT admin claim is only ever
  -- set by trusted server-side flows.
  return new;
end;
$$;

-- ─── Remediation of already-escalated accounts ──────────────────────────────
-- A forged account (signUp({data:{role:'admin'}}) while 0031/0045 were live)
-- would carry profiles.role='admin' and/or a 'admin' mirror in
-- auth.users.raw_app_meta_data (the live is_admin() in 0016 returns true on
-- EITHER). Before writing any destructive cleanup we ENUMERATED the live DB
-- (2026-06-07): exactly two admins exist — the seed saifelleuchi127@gmail.com
-- and the deliberate operator account admin@batta.tn (the only JWT-mirror
-- holder) — and NO forged accounts. So no data remediation is required; the
-- trigger fix above closes the hole going forward.
--
-- If a forged admin is ever found later, demote it with the bypass GUC that
-- 0017/0015 use, e.g. (preserving the two known-good admins):
--   do $$ begin perform set_config('app.bypass_profile_guard','on',true);
--     update public.profiles p set role='individual'::user_role from auth.users u
--      where p.id=u.id and p.role='admin'
--        and u.email not in ('saifelleuchi127@gmail.com','admin@batta.tn');
--     perform set_config('app.bypass_profile_guard','off',true); end $$;

-- Refresh PostgREST so the new function is in effect immediately.
notify pgrst, 'reload schema';
