-- ============================================================================
-- HARDENING — review_kyc must verify the submission belongs to the subject.
--
-- review_kyc takes p_submission_id AND p_subject_id independently and updates
-- kyc_submissions WHERE id=submission and profiles WHERE id=subject with no
-- check that the two refer to the same person. The admin UI always sends a
-- matching pair, and the only caller is the admin route, so this is not an
-- active exploit — but the RPC shouldn't trust its inputs to be consistent: a
-- mismatched pair would verify one user's identity off another's documents.
-- Add the invariant check. Body otherwise verbatim from 0127 (keeps the enum
-- cast fix). Idempotent.
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
  v_verdict kyc_status;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_verdict not in ('verified', 'rejected') then
    raise exception 'bad_verdict';
  end if;
  -- The submission must belong to the subject being reviewed.
  if not exists (
    select 1 from public.kyc_submissions
     where id = p_submission_id and user_id = p_subject_id
  ) then
    raise exception 'submission_mismatch' using errcode = 'P0002';
  end if;
  v_verdict := p_verdict::kyc_status;

  update public.kyc_submissions
     set status           = v_verdict,
         reviewer_id      = auth.uid(),
         rejection_reason = p_notes,
         reviewed_at      = v_now
   where id = p_submission_id;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;

  update public.profiles
     set kyc_status      = v_verdict,
         kyc_verified_at = case when v_verdict = 'verified' then v_now else null end
   where id = p_subject_id;
  if not found then
    raise exception 'subject_not_found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.review_kyc(uuid, uuid, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
