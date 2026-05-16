-- ============================================================================
-- Batta.tn — seed the initial admin account.
--
-- Every "promote user to admin" path goes through admin-only checks, so
-- the very first admin has to be seeded out-of-band. Once the /admin
-- console grows a user-management page, additional admins are added
-- from there by an existing admin.
--
-- We use the same bypass GUC the kyc-submission mirror uses (see
-- migration 0015). The flag is transaction-local and is reset
-- immediately after the protected UPDATE, so it never leaks beyond
-- the one statement that needs it.
--
-- Idempotent: the WHERE clause skips the update if the user doesn't
-- exist (e.g. on a fresh database before signup) or is already admin.
-- ============================================================================

do $$
declare
  v_id uuid;
begin
  select id into v_id
    from auth.users
   where email = 'saifelleuchi127@gmail.com'
   limit 1;

  if v_id is null then
    raise notice 'no auth user found for saifelleuchi127@gmail.com — admin seed skipped';
    return;
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
     set role = 'admin'
   where id = v_id
     and role is distinct from 'admin';
  perform set_config('app.bypass_profile_guard', 'off', true);

  raise notice 'admin seed complete for user %', v_id;
end $$;
