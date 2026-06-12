-- ============================================================================
-- BUGFIX (consistency) — make inspector approval atomic.
--
-- The admin approve route did TWO separate writes: inspectors.approved=true,
-- then profiles.role='inspector'. If the second failed (transient error, RLS,
-- a guard), the inspector was left half-elevated: approved in the inspectors
-- table but still role='individual' everywhere RLS / route guards check — so
-- they couldn't actually act. This SECURITY DEFINER RPC does both writes in one
-- transaction (a function body is one transaction) so they commit or roll back
-- together. is_admin() self-guard mirrors the other admin RPCs. (inspectors.id
-- IS the user/profile id, as the route's matching .eq("id", id) shows; 'inspector'
-- is a bare enum literal so no text→enum cast issue.)
-- ============================================================================

create or replace function public.admin_approve_inspector(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.inspectors
     set approved = true, approved_at = now()
   where id = p_id;
  if not found then
    raise exception 'inspector_not_found' using errcode = 'P0002';
  end if;

  update public.profiles
     set role = 'inspector'
   where id = p_id;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_approve_inspector(uuid) from public;
grant execute on function public.admin_approve_inspector(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
