-- Rollback of 0196 · check_rate_limit() returns to its 0116 body: the count
-- and the hit are two steps again, so requests arriving at the same moment
-- may pass a cap together. Grants stay as 0157 left them (service_role only).

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

revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

notify pgrst, 'reload schema';
