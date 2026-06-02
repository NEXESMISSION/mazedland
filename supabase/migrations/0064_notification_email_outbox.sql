-- 0064: email-outbox columns on notifications
--
-- Until now every notification (you won / payment due / payment accepted /
-- KYC verdict …) was in-app only. A winner who isn't on the site had no way
-- to learn they must pay — a real risk to the money flow.
--
-- Rather than a second delivery table, we treat the existing notifications
-- table as the outbox: a Vercel-cron worker (/api/cron/notify-email) scans
-- for unsent emailable rows and sends them via Resend, stamping emailed_at.
-- This covers every notification source (SQL triggers AND TS routes) from one
-- place, because they all land here.

alter table public.notifications
  add column if not exists emailed_at     timestamptz,
  add column if not exists email_attempts int not null default 0;

-- Partial index for the worker's hot query: "unsent, recent, retryable".
-- Tiny — only covers rows still awaiting an email.
create index if not exists idx_notifications_email_pending
  on public.notifications (created_at)
  where emailed_at is null;
