-- ============================================================================
-- OBSERVABILITY / PRIVACY (GDPR) — minimize PII retention in activity_log.
--
-- 0056 kept raw client IP + user_agent + a user_email snapshot, and
-- prune_activity_log only DELETED whole rows at 90d/365d — it never redacted
-- the PII of rows it kept, and the email snapshot was deliberately retained
-- forever (defeating account deletion). For a money platform that is a
-- retention-minimization failure (IP is personal data; email tied to financial
-- actions for up to a year).
--
-- This rewrites prune_activity_log (same name/schedule) to:
--   1. NULL the network PII (ip / user_agent / referer) on any row older than
--      30 days while KEEPING the row for audit (who-did-what stays; where-from
--      is dropped early).
--   2. Scrub the email snapshot of users who have been deleted/anonymised
--      (user_id nulled by ON DELETE SET NULL, or the auth email tombstoned to
--      …@deleted.invalid by the account-deletion flow) — so deleting an account
--      actually removes the email from the audit trail.
--   3. Keep the existing row retention (page_view 90d, everything 365d).
-- Idempotent (create or replace); the pg_cron schedule from 0056 is unchanged.
-- ============================================================================

create or replace function public.prune_activity_log()
returns void
language sql
security definer
set search_path = public, auth
as $$
  -- 1) Drop network PII early; keep the row.
  update public.activity_log
     set ip = null, user_agent = null, referer = null
   where created_at < now() - interval '30 days'
     and (ip is not null or user_agent is not null or referer is not null);

  -- 2) Scrub the email of deleted/anonymised users.
  update public.activity_log al
     set user_email = null
   where al.user_email is not null
     and (
       al.user_id is null
       or exists (
         select 1 from auth.users u
          where u.id = al.user_id
            and (u.email is null or u.email like '%@deleted.invalid')
       )
     );

  -- 3) Row retention (unchanged).
  delete from public.activity_log
   where (type = 'page_view' and created_at < now() - interval '90 days')
      or (created_at < now() - interval '365 days');
$$;

notify pgrst, 'reload schema';
