-- 0142: SMS-outbox columns + claim RPC + per-user opt-out.
--
-- WinSMS is wired (used for signup OTP). This adds an SMS delivery channel for
-- IMPORTANT notifications, IN ADDITION to the in-app bell + the email outbox.
-- Mirrors the email-outbox design (0064 columns + 0111 atomic claim): the
-- notifications table IS the outbox; a cron worker (/api/cron/notify-sms) claims
-- unsent SMS-eligible rows, sends via WinSMS, and stamps sms_sent_at. Covers
-- every notification source (SQL triggers AND TS routes) because they all land
-- in this one table — no change to how notifications are enqueued.

-- 1. Outbox columns — twin of emailed_at / email_attempts (0064).
alter table public.notifications
  add column if not exists sms_sent_at  timestamptz,
  add column if not exists sms_attempts int not null default 0;

-- 2. Partial index for the worker's hot query: unsent rows only (tiny).
create index if not exists idx_notifications_sms_pending
  on public.notifications (created_at)
  where sms_sent_at is null;

-- 3. Per-user opt-out. Important SMS is ON by default (users want to know they
--    won / payment is due); the account-settings toggle flips this to false.
alter table public.profiles
  add column if not exists sms_notifications_enabled boolean not null default true;

-- 4. Atomic claim for the SMS drain — twin of claim_emailable_notifications
--    (0111). Same SELECT … FOR UPDATE SKIP LOCKED + attempts++ so overlapping
--    runs grab DISJOINT rows (no double-send / double-charge) and a crashed run
--    leaves rows reclaimable up to p_max_attempts. Extra gate vs the email twin:
--    only claim rows whose recipient HAS a phone and has NOT opted out, so
--    opted-out / phoneless users never burn attempts and never get an SMS.
create or replace function public.claim_smsable_notifications(
  p_limit        int,
  p_kinds        text[],
  p_since        timestamptz,
  p_max_attempts int
)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.notifications n
     set sms_attempts = n.sms_attempts + 1
   where n.id in (
     select nn.id
       from public.notifications nn
      where nn.sms_sent_at is null
        and nn.sms_attempts < p_max_attempts
        and nn.kind = any (p_kinds)
        and nn.created_at >= p_since
        and exists (
          select 1
            from public.profiles p
           where p.id = nn.user_id
             and p.phone is not null
             and p.sms_notifications_enabled = true
        )
      order by nn.created_at asc
      for update skip locked
      limit greatest(p_limit, 0)
   )
   returning n.*;
end;
$$;

revoke all on function public.claim_smsable_notifications(int, text[], timestamptz, int) from public;
grant execute on function public.claim_smsable_notifications(int, text[], timestamptz, int) to service_role;

notify pgrst, 'reload schema';
