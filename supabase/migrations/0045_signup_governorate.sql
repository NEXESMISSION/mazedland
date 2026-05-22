-- ============================================================================
-- Thread `governorate` through the new-user trigger so signup can collect
-- the seller/buyer's ville at the same time as their full name + phone.
-- The column has existed on public.profiles since 0001_init; only the
-- trigger needed widening to pick it up out of raw_user_meta_data.
--
-- The function is idempotent (CREATE OR REPLACE), so this migration is
-- safe to run more than once.
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
    coalesce(
      (new.raw_user_meta_data ->> 'role')::user_role,
      'individual'::user_role
    ),
    coalesce(new.raw_user_meta_data ->> 'language', 'ar'),
    coalesce(new.raw_user_meta_data ->> 'governorate', null)
  )
  on conflict (id) do nothing;

  if (new.raw_user_meta_data ->> 'role') = 'admin' then
    update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('role', 'admin')
      where id = new.id;
  end if;

  return new;
end;
$$;

-- Helpful index for the phone→email lookup the login form does when
-- the user signs in with their phone number. Without it the API route
-- does a sequential scan on every login attempt. Partial so we only
-- index rows that actually carry a phone.
create index if not exists profiles_phone_idx
  on public.profiles (phone)
  where phone is not null;
