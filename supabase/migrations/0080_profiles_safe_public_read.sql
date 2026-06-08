-- ============================================================================
-- SECURITY (High) — B6, the AUTHENTICATED vector. Close it for real.
--
-- 0068/0075/0076 stopped the ANON phone/kyc scrape, but the row policy
-- `profiles_public_read_actors` (0005) has no role clause, so it also applies
-- to `authenticated`; combined with 0075's full-table SELECT grant to
-- authenticated, ANY logged-in user could
--   profiles?select=phone,kyc_status,trust_score,governorate  (over every
-- agency/bank/inspector/active-seller row). GDPR-grade exposure that 0068's own
-- comment admitted and punted.
--
-- Column-level grants can't distinguish "my own row" from "someone else's", and
-- dozens of self-reads (middleware kyc_status, account, auth.ts, …) need the
-- sensitive columns on the SELF row — so we cannot simply revoke columns from
-- authenticated. The robust fix is the one the audit prescribed:
--
--   1. DROP the broad actor row-policy. After this, `profiles` direct reads are
--      self-only (profiles_self_read) + admin (profiles_admin_write). No
--      cross-user read of ANY column — the scrape is dead for anon AND auth.
--   2. Expose public/cross-user reads through a SECURITY DEFINER view that
--      projects ONLY {id, full_name, role} (never phone/kyc/trust/governorate).
--      For a logged-in caller it resolves ANY user's name (bid history,
--      inspection requester/inspector names); for anon it stays restricted to
--      public actors — so anon exposure does NOT widen vs. before.
--   3. A relationship-scoped RPC for the one legitimate cross-user PHONE read
--      (a booking party fetching their inspector's contact).
--
-- App consumers that embedded `profiles(full_name)` are repointed to the view /
-- batched lookups in the same commit (PostgREST can't embed a view by FK).
-- ============================================================================

-- 1) Kill the broad actor read policy. profiles is now self + admin only.
drop policy if exists profiles_public_read_actors on public.profiles;

-- 2) Safe public projection. security_invoker = false → runs as the (table-
--    owning) view owner and bypasses profiles RLS, but only ever projects the
--    three non-sensitive columns. auth.uid() still reflects the CALLER.
drop view if exists public.public_profiles;
create view public.public_profiles
with (security_invoker = false) as
  select p.id, p.full_name, p.role
    from public.profiles p
   where
     -- Any authenticated caller may resolve any display name (needed for bid
     -- history + inspection counterparties). Still NO sensitive columns.
     auth.uid() is not null
     -- Anon: restricted to public-facing actors only — same rows the old
     -- policy exposed, so no widening of unauthenticated exposure.
     or p.role in ('agency', 'bank', 'bailiff')
     or exists (select 1 from public.inspectors i where i.id = p.id and i.approved)
     or exists (select 1 from public.properties pr
                 where pr.owner_id = p.id and pr.status = 'ready');

grant select on public.public_profiles to anon, authenticated;

-- 3) Relationship-scoped inspector contact. Returns the assigned inspector's
--    name + phone ONLY to a party of that inspection (requester / inspector /
--    property owner / admin). Replaces the broad profiles.phone read that the
--    dropped policy used to permit.
create or replace function public.get_inspection_contact(p_inspection_id uuid)
returns table (full_name text, phone text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_inspector uuid;
  v_requester uuid;
  v_owner     uuid;
begin
  if v_uid is null then
    raise exception 'auth' using errcode = '28000';
  end if;

  select ins.inspector_id, ins.requested_by, pr.owner_id
    into v_inspector, v_requester, v_owner
    from public.inspections ins
    left join public.properties pr on pr.id = ins.property_id
   where ins.id = p_inspection_id;
  if not found then
    return;  -- unknown inspection → empty result
  end if;

  if v_uid <> coalesce(v_requester, '00000000-0000-0000-0000-000000000000'::uuid)
     and v_uid <> coalesce(v_inspector, '00000000-0000-0000-0000-000000000000'::uuid)
     and v_uid <> coalesce(v_owner, '00000000-0000-0000-0000-000000000000'::uuid)
     and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_inspector is null then
    return;  -- not yet assigned → no contact to share
  end if;

  return query
    select p.full_name, p.phone
      from public.profiles p
     where p.id = v_inspector;
end;
$$;

grant execute on function public.get_inspection_contact(uuid) to authenticated;

notify pgrst, 'reload schema';
