-- ============================================================================
-- BUGFIX (CRITICAL) — review_kyc could never approve KYC.
--
-- review_kyc (0058) assigns the TEXT parameter p_verdict straight into enum
-- columns:  kyc_submissions.status (kyc_status) and profiles.kyc_status. In
-- PostgreSQL there is NO implicit cast from a text *variable* to an enum (only
-- bare literals coerce), so the first UPDATE always raised:
--
--   column "status" is of type kyc_status but expression is of type text
--
-- i.e. the admin KYC-review route (POST /api/admin/kyc/[id]) 500'd on EVERY
-- verdict — no account could be verified through the admin UI, which gates the
-- whole bid/buy funnel (place_bid requires kyc_status='verified'). The RPC
-- test suite missed it because its fixtures set kyc_status via a direct
-- service-role UPDATE, never through review_kyc.
--
-- Fix: cast p_verdict to kyc_status explicitly in both UPDATEs. The
-- 'verified'/'rejected' guard above already constrains the value, so the cast
-- is always valid. Body otherwise verbatim from 0058. Idempotent.
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
  -- Safe to cast now that the value is constrained to a valid enum label.
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
