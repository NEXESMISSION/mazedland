-- ============================================================================
-- Batta.tn — make KYC review atomic.
--
-- The admin KYC route updated two tables in sequence:
--   1) kyc_submissions.status = verdict
--   2) profiles.kyc_status   = verdict
-- as separate statements. If (2) failed after (1) committed, you got a
-- "verified submission / unverified profile" mismatch: the queue shows the
-- case resolved, but the user still can't bid — a wedged state on a
-- real-identity action.
--
-- This SECURITY DEFINER RPC does both writes in a single transaction (a
-- function body is one transaction), so they commit or roll back together.
-- It self-guards with is_admin() so it can't be called by a normal user via
-- PostgREST. The route calls it on the user-bound client (auth.uid() = the
-- reviewing admin).
-- ============================================================================

create or replace function public.review_kyc(
  p_submission_id uuid,
  p_subject_id    uuid,
  p_verdict       text,
  p_notes         text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_verdict not in ('verified', 'rejected') then
    raise exception 'bad_verdict';
  end if;

  update public.kyc_submissions
     set status           = p_verdict,
         reviewer_id      = auth.uid(),
         rejection_reason = p_notes,
         reviewed_at      = v_now
   where id = p_submission_id;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;

  update public.profiles
     set kyc_status      = p_verdict,
         kyc_verified_at = case when p_verdict = 'verified' then v_now else null end
   where id = p_subject_id;
  if not found then
    raise exception 'subject_not_found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.review_kyc(uuid, uuid, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
