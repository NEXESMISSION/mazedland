-- ============================================================================
-- Auto-create a public.profiles row on auth.users insert and copy the
-- relevant fields out of raw_user_meta_data. Without this, every new
-- signup needs a follow-up POST to populate the profile, and RLS rules
-- that join on profiles silently fail for fresh users.
-- ============================================================================

create or replace function public._on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'phone', null),
    coalesce(
      (new.raw_user_meta_data ->> 'role')::user_role,
      'individual'::user_role
    ),
    coalesce(new.raw_user_meta_data ->> 'language', 'ar')
  )
  on conflict (id) do nothing;

  -- Mirror the role into auth.users.raw_app_meta_data so the
  -- public.is_admin() function (and any future role-claim checks)
  -- find it on the JWT without an extra DB round-trip.
  if (new.raw_user_meta_data ->> 'role') = 'admin' then
    update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('role', 'admin')
      where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._on_auth_user_created();
