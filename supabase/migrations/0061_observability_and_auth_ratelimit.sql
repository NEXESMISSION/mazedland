-- ============================================================================
-- Batta.tn — observability error sink + robust auth rate-limit.
--
-- 1) Widen activity_log.type to allow 'error' so server + client errors persist
--    to a queryable table AND show up in the existing /admin/activity viewer
--    (no new admin UI needed — reuses the type filter). Errors were previously
--    only in ephemeral stdout/logs.
--
-- 2) DB-backed rate limit for the phone→email auth lookup. The route had an
--    in-process limiter (resets per serverless instance); this makes it
--    cross-instance robust against phone enumeration, mirroring the waitlist
--    limiter pattern.
-- ============================================================================

-- 1. activity_log: allow type='error'
alter table public.activity_log drop constraint if exists activity_log_type_check;
alter table public.activity_log
  add constraint activity_log_type_check check (type in ('page_view', 'action', 'error'));

-- 2. Auth attempt rate limit (per IP). SECURITY DEFINER so the anon role can
--    call it during the pre-auth phone lookup. Returns true when BLOCKED.
create table if not exists public.auth_attempts (
  ip           text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists auth_attempts_ip_idx
  on public.auth_attempts (ip, attempted_at desc);
alter table public.auth_attempts enable row level security;
-- No policies → only SECURITY DEFINER functions / service role can touch it.

create or replace function public.check_auth_ratelimit(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  if p_ip is null or p_ip = '' then
    return false; -- can't identify caller → don't block (route also limits)
  end if;
  select count(*) into v_recent
    from public.auth_attempts
   where ip = p_ip
     and attempted_at >= now() - interval '5 minutes';
  -- Opportunistic cleanup so the table never grows unbounded.
  delete from public.auth_attempts where attempted_at < now() - interval '1 day';
  if v_recent >= 20 then
    return true; -- blocked
  end if;
  insert into public.auth_attempts (ip) values (p_ip);
  return false;
end;
$$;

grant execute on function public.check_auth_ratelimit(text) to anon, authenticated;

notify pgrst, 'reload schema';
