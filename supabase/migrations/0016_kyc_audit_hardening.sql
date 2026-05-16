-- ============================================================================
-- Batta.tn — KYC audit hardening (post-0015 follow-ups).
--
-- The 0015 fix unblocked first-time KYC submission, but the audit pass
-- surfaced three more issues in the same surface:
--
--   1. is_admin() only reads the JWT app_metadata.role claim, which the
--      signup trigger (0006) never sets. A user promoted to admin via
--      `profiles.role='admin'` is NOT recognised as admin by triggers
--      or RLS policies — so the admin KYC verdict route, the inspector
--      role-elevation flow, and every other guard would all fail with
--      "forbidden" the first time they were exercised.
--
--   2. kyc_submissions has full row-level RW for the owning user, with
--      no column-level protection. A user resubmitting after rejection
--      can overwrite admin-audit columns (reviewer_id, reviewed_at,
--      rejection_reason) and arbitrarily flip status. The processing
--      page currently sends NULLs for those columns on every upsert.
--
--   3. _mirror_kyc_submission fires only on AFTER INSERT. Resubmissions
--      are an UPSERT-as-UPDATE (unique index on user_id), so the
--      profile's kyc_status stays at 'rejected' forever — the user
--      lands on the rejection screen even after re-submitting cleanly.
-- ============================================================================

-- ─── 1. is_admin(): JWT claim OR profiles.role='admin' ──────────────────────
-- The JWT path stays as the fast path (no table read, no SECURITY
-- DEFINER recursion concerns). The profiles fallback is SECURITY
-- DEFINER so it bypasses the profile-read RLS policy and works
-- regardless of how the user got their session.
--
-- Marked STABLE so PostgREST and the planner can still cache calls
-- inside a single statement.

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) then
    return true;
  end if;
  if v_uid is null then
    return false;
  end if;
  select role::text into v_role from public.profiles where id = v_uid;
  return v_role = 'admin';
end;
$$;

-- ─── 2. kyc_submissions: lock down admin-audit columns ─────────────────────
-- The owning user can still INSERT (first submission) and UPDATE
-- (resubmission), but on UPDATE non-admins:
--   - can only flip status from 'rejected' → 'submitted'
--   - cannot touch reviewer_id / reviewed_at / rejection_reason
-- We silently restore the old admin-audit values instead of raising,
-- so the existing processing-page payload (which sends those columns
-- as null) keeps working without a client refactor. The client-side
-- patch in this same change set stops sending them altogether.

create or replace function public._guard_kyc_submission_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;

  if new.status is distinct from old.status then
    if not (old.status = 'rejected' and new.status = 'submitted') then
      raise exception 'forbidden: only admin can change kyc submission status';
    end if;
  end if;

  new.reviewer_id      := old.reviewer_id;
  new.reviewed_at      := old.reviewed_at;
  new.rejection_reason := old.rejection_reason;

  return new;
end;
$$;

drop trigger if exists guard_kyc_submission_self_update on public.kyc_submissions;
create trigger guard_kyc_submission_self_update
  before update on public.kyc_submissions
  for each row execute function public._guard_kyc_submission_self_update();

-- ─── 3. mirror_kyc_submission: also fire on UPDATE, refresh submitted_at ──
-- Resubmissions are an UPSERT-as-UPDATE so the original INSERT-only
-- trigger missed them. Now we mirror whenever the row lands with
-- status='submitted' — INSERT (first time) or UPDATE (resubmission).
-- We also refresh kyc_submitted_at on every mirror (was: coalesce,
-- which made the timestamp stick to the *first* submission forever).

create or replace function public._mirror_kyc_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from 'submitted' then
    return new;
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
     set kyc_status = 'submitted',
         kyc_submitted_at = now()
   where id = new.user_id
     and kyc_status not in ('verified');
  perform set_config('app.bypass_profile_guard', 'off', true);
  return new;
end;
$$;

drop trigger if exists mirror_kyc_submission on public.kyc_submissions;
create trigger mirror_kyc_submission
  after insert or update on public.kyc_submissions
  for each row execute function public._mirror_kyc_submission();

notify pgrst, 'reload schema';
