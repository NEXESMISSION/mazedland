-- ============================================================================
-- 0167 · The publish guard recognises the service role again
--
-- 0146's guard lets a row into 'published' only for the service role (the
-- paid / credited / free / admin paths, all server-side) or an admin. It
-- recognised the service role by `request.jwt.claim.role` — a setting the
-- API layer no longer sends: PostgREST now puts the whole token in
-- `request.jwt.claims`. And `current_user` cannot stand in for it inside a
-- SECURITY DEFINER function, where it is the function's owner.
--
-- So every server-side publication failed with publication_requires_payment:
-- an admin's approval, a free publication, a paid one captured, a renewal.
-- The last annonce to go online did so on 2026-09-05. Found on 2026-10-21
-- while testing rentals (0166): an UPDATE draft → published through the
-- service key is refused on the live database.
--
-- The check now reads the role from `auth.jwt()` — Supabase's own reader of
-- the current token — and keeps the old setting as a fallback. A user's own
-- token says 'authenticated', never 'service_role', so nothing a browser
-- sends can pass it; is_admin() still covers an admin's own session.
-- ============================================================================

create or replace function public._listings_guard_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not (
       coalesce(auth.jwt() ->> 'role', '') = 'service_role'
       or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
       or public.is_admin()
     ) then
    raise exception 'publication_requires_payment'
      using errcode = 'P0001',
            hint = 'A listing is published by the payment/credit path or by an admin.';
  end if;
  return new;
end;
$$;
