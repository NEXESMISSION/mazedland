-- Rollback of 0194 · broadcast_notification() returns to its 0035 shape: any
-- kind and any link again, from any admin. Nothing stored is lost.

create or replace function public.broadcast_notification(
  p_kind     text,
  p_title    text,
  p_body     text,
  p_link     text,
  p_audience jsonb,
  p_payload  jsonb default '{}'::jsonb
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin      uuid := auth.uid();
  v_broadcast  uuid := gen_random_uuid();
  v_count      int  := 0;
  v_type       text;
  v_role       text;
  v_ids        uuid[];
  v_payload    jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if coalesce(length(trim(p_kind)),  0) = 0 then raise exception 'kind_required';  end if;
  if coalesce(length(trim(p_title)), 0) = 0 then raise exception 'title_required'; end if;

  v_type := lower(coalesce(p_audience ->> 'type', ''));

  if v_type = 'all' then
    insert into public.notifications
      (user_id, kind, title, body, link, payload, created_by, broadcast_id)
    select p.id, p_kind, p_title, nullif(p_body, ''), nullif(p_link, ''), v_payload, v_admin, v_broadcast
      from public.profiles p;
    get diagnostics v_count = row_count;

  elsif v_type = 'role' then
    v_role := p_audience ->> 'role';
    if coalesce(length(trim(v_role)), 0) = 0 then raise exception 'role_required'; end if;
    insert into public.notifications
      (user_id, kind, title, body, link, payload, created_by, broadcast_id)
    select p.id, p_kind, p_title, nullif(p_body, ''), nullif(p_link, ''), v_payload, v_admin, v_broadcast
      from public.profiles p
     where p.role::text = v_role;
    get diagnostics v_count = row_count;

  elsif v_type = 'users' then
    select array_agg((x)::uuid)
      into v_ids
      from jsonb_array_elements_text(coalesce(p_audience -> 'ids', '[]'::jsonb)) as x;
    if v_ids is null or array_length(v_ids, 1) is null then
      raise exception 'ids_required';
    end if;
    insert into public.notifications
      (user_id, kind, title, body, link, payload, created_by, broadcast_id)
    select p.id, p_kind, p_title, nullif(p_body, ''), nullif(p_link, ''), v_payload, v_admin, v_broadcast
      from public.profiles p
     where p.id = any(v_ids);
    get diagnostics v_count = row_count;

  else
    raise exception 'unknown_audience_type' using detail = v_type;
  end if;

  return json_build_object(
    'broadcast_id', v_broadcast,
    'count',        v_count,
    'kind',         p_kind
  );
end;
$$;

notify pgrst, 'reload schema';
