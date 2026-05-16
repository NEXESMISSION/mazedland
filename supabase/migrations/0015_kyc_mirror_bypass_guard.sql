-- ============================================================================
-- Batta.tn — fix kyc_submissions upsert blocked by profile guard.
--
-- Repro: a freshly-signed-up user (kyc_status='none') completes the KYC
-- flow and the processing page upserts kyc_submissions. The AFTER INSERT
-- trigger `_mirror_kyc_submission` then UPDATEs profiles.kyc_status to
-- 'submitted'. That fires the BEFORE UPDATE trigger
-- `_guard_profile_self_update`, which raises:
--
--     P0001: forbidden: cannot change protected column without admin
--
-- The comment in 0006_security_lockdown claimed SECURITY DEFINER on the
-- mirror would bypass the guard. It does not: `is_admin()` reads
-- `auth.jwt() -> 'app_metadata' ->> 'role'`, and SECURITY DEFINER swaps
-- the executing ROLE — not the JWT. The user's JWT (no admin claim)
-- still wins, and the guard blocks the change.
--
-- Fix: a transaction-local GUC (`app.bypass_profile_guard`) that the
-- mirror sets just before its UPDATE and unsets right after. The guard
-- checks the GUC; when set, it returns early. Scope is `is_local=true`
-- so the flag dies with the transaction even if the unset is skipped
-- (e.g. by an exception), and the explicit unset keeps the window to
-- just the one statement that needs it.
-- ============================================================================

create or replace function public._mirror_kyc_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Open the bypass window for exactly one statement.
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
     set kyc_status = 'submitted',
         kyc_submitted_at = coalesce(kyc_submitted_at, now())
   where id = new.user_id
     and kyc_status not in ('verified');
  perform set_config('app.bypass_profile_guard', 'off', true);
  return new;
end;
$$;

create or replace function public._guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;

  -- Trusted server-side triggers (currently _mirror_kyc_submission) open
  -- a bypass window via set_config(..., is_local=true). The flag is
  -- transaction-scoped and is unset immediately after the trusted UPDATE.
  if current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.kyc_status is distinct from old.kyc_status
     or new.kyc_submitted_at is distinct from old.kyc_submitted_at
     or new.kyc_verified_at is distinct from old.kyc_verified_at
     or new.trust_score is distinct from old.trust_score then
    raise exception 'forbidden: cannot change protected column without admin';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
