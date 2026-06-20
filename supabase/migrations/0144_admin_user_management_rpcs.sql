-- ============================================================================
-- ADMIN — user-management RPCs for the /admin/users directory (2026-06-16).
--
-- Lets an admin change a user's ROLE (incl. promoting to 'admin') and KYC
-- status. Both columns are protected by _guard_profile_self_update (0015),
-- which only lets is_admin() (JWT app_metadata.role) OR a trusted, transaction-
-- local bypass window through. The admin API route is gated by requireAdmin
-- (profiles.role='admin') and calls these via the SERVICE-ROLE client — whose
-- JWT is NOT admin — so each RPC opens the same `app.bypass_profile_guard` GUC
-- the KYC mirror uses (0015) for exactly its one UPDATE.
--
-- SECURITY: granted to service_role ONLY (revoked from anon/authenticated), so
-- they are unreachable from a browser. The security boundary is the API route's
-- requireAdmin check; service_role is server-only.
--
-- NOTE: a FUNCTIONAL admin also needs the auth JWT claim
-- (app_metadata.role='admin'), which is_admin() reads — the API route sets that
-- via auth.admin.updateUserById. These RPCs own only the profiles.* columns.
-- ============================================================================

create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
     set role = p_role, updated_at = now()
   where id = p_user_id;
  v_found := found;
  perform set_config('app.bypass_profile_guard', 'off', true);
  if not v_found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_set_kyc_status(p_user_id uuid, p_status public.kyc_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
     set kyc_status      = p_status,
         kyc_verified_at = case when p_status = 'verified' then now() else null end,
         updated_at      = now()
   where id = p_user_id;
  v_found := found;
  perform set_config('app.bypass_profile_guard', 'off', true);
  if not v_found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_set_user_role(uuid, public.user_role) from public, anon, authenticated;
revoke execute on function public.admin_set_kyc_status(uuid, public.kyc_status) from public, anon, authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to service_role;
grant execute on function public.admin_set_kyc_status(uuid, public.kyc_status) to service_role;

notify pgrst, 'reload schema';
