-- ============================================================================
-- ABUSE / SCALABILITY — a generic cross-instance rate limiter.
--
-- Several endpoints relied on per-serverless-instance in-memory Maps (reset on
-- cold start, ineffective under horizontal scale) or had NONE — notably
-- optimize-image, which decodes up to 30MB through sharp/libvips with only an
-- auth + size gate (CPU/memory denial-of-wallet). This adds a DB-backed limiter
-- keyed by an arbitrary string so the cap holds across instances.
--
-- Unlike check_auth_ratelimit (0061), the prune here is scoped to the CALLING
-- key (not a table-wide DELETE on every call), so it doesn't self-amplify
-- writes under a flood; a daily cron sweeps abandoned keys.
-- ============================================================================

create table if not exists public.rate_limits (
  key    text        not null,
  hit_at timestamptz not null default now()
);
create index if not exists rate_limits_key_time_idx on public.rate_limits (key, hit_at desc);
alter table public.rate_limits enable row level security;
-- No policies — only the SECURITY DEFINER function below (and service_role) touch it.

-- Returns TRUE when the caller is OVER the cap (should be blocked), else records
-- the hit and returns FALSE. Fail-open is the caller's choice (treat a null/error
-- as not-limited) since this is abuse-throttling, not an auth boundary.
create or replace function public.check_rate_limit(
  p_key         text,
  p_max         int,
  p_window_secs int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.rate_limits
   where key = p_key and hit_at < now() - make_interval(secs => greatest(p_window_secs, 1));
  select count(*) into v_count
    from public.rate_limits
   where key = p_key and hit_at >= now() - make_interval(secs => greatest(p_window_secs, 1));
  if v_count >= greatest(p_max, 1) then
    return true;
  end if;
  insert into public.rate_limits (key) values (p_key);
  return false;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to authenticated, service_role;

-- Bounded growth: sweep rows older than a day (abandoned keys) once daily.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'prune_rate_limits') then
      perform cron.unschedule('prune_rate_limits');
    end if;
    perform cron.schedule(
      'prune_rate_limits', '23 3 * * *',
      $cron$ delete from public.rate_limits where hit_at < now() - interval '1 day'; $cron$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
