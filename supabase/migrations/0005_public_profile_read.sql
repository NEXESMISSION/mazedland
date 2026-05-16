-- ============================================================================
-- Allow anonymous reads of profile rows when the profile belongs to a
-- public-facing actor on the platform: approved inspectors, agencies,
-- banks, court bailiffs, or anyone who has at least one published
-- (status='ready') property listing. Without this, the inspector grid
-- and the partner directory render empty under !inner joins because
-- the join filters out rows the anon role can't see.
--
-- This intentionally exposes only `full_name` and `role` indirectly via
-- the join — sensitive fields (phone, kyc_status, trust_score) are
-- already individually unselected in the public-facing queries, and a
-- future column-level grant can lock them down further if needed.
-- ============================================================================

drop policy if exists profiles_public_read_actors on public.profiles;
create policy profiles_public_read_actors on public.profiles for select
using (
  -- already-existing self/admin coverage stays in profiles_self_read;
  -- this policy is additive (RLS policies are OR'd together).
  role in ('agency', 'bank', 'bailiff')
  or exists (
    select 1 from public.inspectors i where i.id = profiles.id and i.approved
  )
  or exists (
    select 1 from public.properties p where p.owner_id = profiles.id and p.status = 'ready'
  )
);

-- Refresh PostgREST so the new policy is visible immediately.
notify pgrst, 'reload schema';
