-- ============================================================================
-- 0196 · check_rate_limit() holds under concurrency
--
-- The limiter of 0116 counted, then inserted: requests arriving at the same
-- moment all counted the same figure and all passed — the QA tour
-- (2026-10-30) saw 62 of 66 parallel calls go through a cap of 60 on
-- /api/ai/listing-chat. The count and the hit now run under a
-- transaction-level advisory lock on the key, so for one key they happen one
-- caller at a time; different keys never wait for each other. Same
-- signature, same callers, same grants (0157: service_role only).
--
-- Rollback: supabase/rollbacks/0196_rate_limit_lock.down.sql.
-- ============================================================================

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
  -- Held until the calling transaction ends (one statement, through PostgREST).
  perform pg_advisory_xact_lock(hashtext('rate_limit:' || p_key));
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

revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

notify pgrst, 'reload schema';
