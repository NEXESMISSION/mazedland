-- ============================================================================
-- Fix-up for match_popups(): cast the role column to text before comparing
-- against the audience.roles[] array. The original 0053 used `pr.role = any(
-- text[])` which errors with `operator does not exist: user_role = text`
-- because profiles.role is a custom enum, not text. Cast pr.role::text and
-- the comparison works without changing the rest of the matcher.
-- ============================================================================

create or replace function public.match_popups(
  p_path    text,
  p_locale  text default 'fr',
  p_device  text default 'both'
) returns setof public.popups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  return query
    select p.*
      from public.popups p
     where p.status = 'live'
       and (
            p.mode = 'rule'
         or (p.mode = 'broadcast'
             and (p.starts_at is null or p.starts_at <= v_now)
             and (p.ends_at   is null or p.ends_at   >= v_now))
       )
       and (cardinality(p.locales) = 0 or p_locale = any(p.locales))
       and (p.devices = 'both' or p.devices = p_device)
       and (
            (p.audience ->> 'scope') = 'all'
         or ((p.audience ->> 'scope') = 'anon'      and v_uid is null)
         or ((p.audience ->> 'scope') = 'logged_in' and v_uid is not null)
         or (
              v_uid is not null
              and (
                   exists (
                     select 1
                       from public.profiles pr
                      where pr.id = v_uid
                        and pr.role::text = any (
                              coalesce(
                                array(select jsonb_array_elements_text(p.audience -> 'roles')),
                                array[]::text[]
                              )
                            )
                   )
                or v_uid::text = any (
                     coalesce(
                       array(select jsonb_array_elements_text(p.audience -> 'user_ids')),
                       array[]::text[]
                     )
                   )
              )
         )
       )
     order by p.priority desc, p.created_at asc;
end;
$$;

revoke all on function public.match_popups(text, text, text) from public;
grant execute on function public.match_popups(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
