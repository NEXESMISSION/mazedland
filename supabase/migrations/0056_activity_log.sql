-- 0056_activity_log.sql
-- Platform-wide activity / audit log. Captures two kinds of events:
--   * page_view — every (authenticated or anonymous) page navigation,
--     written fire-and-forget from middleware. Answers "who is on the
--     site right now and what pages are they visiting".
--   * action    — meaningful mutations (listing created, KYC submitted,
--     payment / payout / property moderation, settings changes), written
--     from the API routes that perform them.
--
-- All writes go through the service-role client (which bypasses RLS), so
-- there are deliberately NO insert/update/delete policies for normal
-- users. Only admins may read the log.

begin;

create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  -- Null for anonymous visitors. ON DELETE SET NULL so removing a user
  -- never erases the historical trail (we keep the email snapshot).
  user_id     uuid references auth.users(id) on delete set null,
  user_email  text,
  type        text not null check (type in ('page_view', 'action')),
  action      text,            -- e.g. 'login', 'property.approve', 'kyc.submit'
  path        text,            -- pathname visited / route that handled the action
  method      text,            -- HTTP method
  status      integer,         -- response status for actions
  ip          text,            -- best-effort client IP (x-forwarded-for)
  user_agent  text,
  referer     text,
  metadata    jsonb not null default '{}'::jsonb
);

-- Newest-first listing is the default view.
create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);
-- "What did this user do?" lookups.
create index if not exists activity_log_user_idx
  on public.activity_log (user_id, created_at desc);
-- Tab filtering by type (page_view vs action).
create index if not exists activity_log_type_idx
  on public.activity_log (type, created_at desc);
-- Filtering by a specific action name.
create index if not exists activity_log_action_idx
  on public.activity_log (action)
  where action is not null;

alter table public.activity_log enable row level security;

-- Admins (and only admins) can read the entire log. Writes happen via the
-- service-role key which bypasses RLS, so no write policies are defined.
drop policy if exists activity_log_admin_read on public.activity_log;
create policy activity_log_admin_read on public.activity_log
  for select
  using (public.is_admin());

-- Retention: keep page views for 90 days and actions for 1 year so the
-- table doesn't grow without bound. Actions are the audit trail, so they
-- live longer than the higher-volume navigation stream.
create or replace function public.prune_activity_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.activity_log
  where (type = 'page_view' and created_at < now() - interval '90 days')
     or (created_at < now() - interval '365 days');
$$;

-- Schedule daily pruning if pg_cron is available (it is on Supabase).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'prune_activity_log') then
      perform cron.unschedule('prune_activity_log');
    end if;
    perform cron.schedule(
      'prune_activity_log',
      '17 3 * * *',
      $cron$ select public.prune_activity_log(); $cron$
    );
  end if;
end;
$$;

commit;
