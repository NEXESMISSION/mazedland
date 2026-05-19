-- ============================================================================
-- Batta.tn — Admin notification control: broadcasts + queue inspector.
--
-- Adds:
--   * `created_by` (uuid) on notifications  — null = system-triggered;
--     set when an admin manually sends one. Lets us distinguish ops
--     pushes from automated triggers in the queue inspector.
--   * `broadcast_id` (uuid) on notifications — same id stamped across
--     all rows of a single broadcast, so the inspector can show "this
--     was part of broadcast X (N recipients)".
--   * `broadcast_notification()` RPC — fans out one composed message
--     to: all users / a role / a list of user IDs.
--   * `_is_admin_caller()` helper — wraps the existing public.is_admin()
--     so we can guard the RPC without duplicating the role-claim logic.
-- ============================================================================

alter table public.notifications
  add column if not exists created_by   uuid references public.profiles(id) on delete set null,
  add column if not exists broadcast_id uuid;

-- Index for the inspector "show broadcast X" grouping. Partial so we
-- don't bloat the index with the 99% of system-trigger rows.
create index if not exists notifications_broadcast_idx
  on public.notifications(broadcast_id)
  where broadcast_id is not null;

-- Index for "things admin Y has sent" view.
create index if not exists notifications_created_by_idx
  on public.notifications(created_by, created_at desc)
  where created_by is not null;

-- ─── broadcast_notification RPC ─────────────────────────────────────────────
-- Fan out a manually-composed notification to a chosen audience.
--
-- Audience is a jsonb shape:
--   { "type": "all" }
--   { "type": "role",  "role": "individual" | "agency" | ... }
--   { "type": "users", "ids":  ["<uuid>", "<uuid>", ...] }
--
-- Returns { broadcast_id, count } so the caller can show "X recipients
-- notified" and (later) jump into the queue inspector grouped by that id.
-- The function is SECURITY DEFINER but guarded by public.is_admin().

create or replace function public.broadcast_notification(
  p_kind     text,
  p_title    text,
  p_body     text,
  p_link     text,
  p_audience jsonb
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
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if coalesce(length(trim(p_kind)),  0) = 0 then raise exception 'kind_required';  end if;
  if coalesce(length(trim(p_title)), 0) = 0 then raise exception 'title_required'; end if;

  v_type := lower(coalesce(p_audience ->> 'type', ''));

  if v_type = 'all' then
    insert into public.notifications
      (user_id, kind, title, body, link, created_by, broadcast_id)
    select p.id, p_kind, p_title, nullif(p_body, ''), nullif(p_link, ''), v_admin, v_broadcast
      from public.profiles p;
    get diagnostics v_count = row_count;

  elsif v_type = 'role' then
    v_role := p_audience ->> 'role';
    if coalesce(length(trim(v_role)), 0) = 0 then raise exception 'role_required'; end if;
    insert into public.notifications
      (user_id, kind, title, body, link, created_by, broadcast_id)
    select p.id, p_kind, p_title, nullif(p_body, ''), nullif(p_link, ''), v_admin, v_broadcast
      from public.profiles p
     where p.role::text = v_role;
    get diagnostics v_count = row_count;

  elsif v_type = 'users' then
    -- jsonb array → uuid[]. Validates each id is a uuid; bad input raises.
    select array_agg((x)::uuid)
      into v_ids
      from jsonb_array_elements_text(coalesce(p_audience -> 'ids', '[]'::jsonb)) as x;
    if v_ids is null or array_length(v_ids, 1) is null then
      raise exception 'ids_required';
    end if;
    insert into public.notifications
      (user_id, kind, title, body, link, created_by, broadcast_id)
    select p.id, p_kind, p_title, nullif(p_body, ''), nullif(p_link, ''), v_admin, v_broadcast
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

revoke all on function public.broadcast_notification(text, text, text, text, jsonb) from public;
grant execute on function public.broadcast_notification(text, text, text, text, jsonb) to service_role;
grant execute on function public.broadcast_notification(text, text, text, text, jsonb) to authenticated;

-- ─── Admin-scoped read policy on notifications ─────────────────────────────
-- Existing policy `notifications_self_read` restricts SELECT to the
-- recipient. The queue inspector needs admins to see everything, so we
-- add a parallel policy. Both are FOR SELECT so they OR together.

drop policy if exists notifications_admin_read on public.notifications;
create policy notifications_admin_read on public.notifications
  for select using (public.is_admin());

-- Admin-scoped delete (queue inspector can prune mistakes).
drop policy if exists notifications_admin_delete on public.notifications;
create policy notifications_admin_delete on public.notifications
  for delete using (public.is_admin());

notify pgrst, 'reload schema';
