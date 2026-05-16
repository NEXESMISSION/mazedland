-- ============================================================================
-- Inspector dashboard plumbing — closes audit gap #10.
--
-- 1. New private storage bucket `inspection-reports` for the PDF reports
--    inspectors upload after a site visit.
--
-- 2. Storage RLS: only the assigned inspector can write to a path
--    namespaced under `<inspection_id>/...`; only the inspector,
--    requester, property owner, or admin can read it. Mirrors the
--    visibility rules in the existing inspections row policy so a
--    reader of the row can also fetch its file.
--
-- 3. SECURITY DEFINER RPC `update_inspection_status` so the inspector
--    can transition state with a single call (RLS would also allow it
--    via direct UPDATE, but the RPC enforces the legal status graph
--    and writes the report_pdf_path atomically).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('inspection-reports', 'inspection-reports', false)
on conflict (id) do nothing;

-- ─── Storage policies on inspection-reports ────────────────────────────────
-- Path layout: `<inspection_id>/<filename>`. The first segment must
-- match an inspections row that the caller owns (as inspector or
-- requester or property owner) — otherwise read/write is denied.

drop policy if exists "inspection_reports_inspector_write" on storage.objects;
create policy "inspection_reports_inspector_write"
on storage.objects for insert
with check (
  bucket_id = 'inspection-reports'
  and auth.uid() is not null
  and exists (
    select 1 from public.inspections i
    where i.id::text = (storage.foldername(name))[1]
      and i.inspector_id = auth.uid()
  )
);

drop policy if exists "inspection_reports_inspector_update" on storage.objects;
create policy "inspection_reports_inspector_update"
on storage.objects for update
using (
  bucket_id = 'inspection-reports'
  and exists (
    select 1 from public.inspections i
    where i.id::text = (storage.foldername(name))[1]
      and i.inspector_id = auth.uid()
  )
);

drop policy if exists "inspection_reports_visible_read" on storage.objects;
create policy "inspection_reports_visible_read"
on storage.objects for select
using (
  bucket_id = 'inspection-reports'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.inspections i
      left join public.properties p on p.id = i.property_id
      where i.id::text = (storage.foldername(name))[1]
        and (
          i.inspector_id = auth.uid()
          or i.requested_by = auth.uid()
          or p.owner_id = auth.uid()
        )
    )
  )
);

-- ─── State-transition RPC ──────────────────────────────────────────────────
-- Allowed transitions:
--   requested  → scheduled, cancelled
--   scheduled  → in_progress, cancelled
--   in_progress → submitted (must include report_pdf_path)
--   submitted  → approved (admin only)
--   *          → cancelled (inspector or admin only — requester cancels via separate flow)

create or replace function public.update_inspection_status(
  p_inspection_id uuid,
  p_new_status   inspection_status,
  p_report_path  text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_row    public.inspections;
  v_role   user_role;
  v_admin  boolean := public.is_admin();
begin
  if v_uid is null then
    raise exception 'auth' using errcode = '42501';
  end if;
  select * into v_row from public.inspections where id = p_inspection_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select role into v_role from public.profiles where id = v_uid;

  -- Anything except 'approved' has to come from the assigned inspector
  -- (or admin). 'approved' is admin-only; the inspector themself can't
  -- self-certify their own report.
  if p_new_status = 'approved' then
    if not v_admin then
      raise exception 'forbidden_admin_only' using errcode = '42501';
    end if;
  else
    if v_row.inspector_id <> v_uid and not v_admin then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Legal transition graph.
  if not (
    (v_row.status = 'requested'  and p_new_status in ('scheduled','cancelled'))
    or (v_row.status = 'scheduled'  and p_new_status in ('in_progress','cancelled'))
    or (v_row.status = 'in_progress' and p_new_status = 'submitted')
    or (v_row.status = 'submitted'  and p_new_status = 'approved')
  ) then
    raise exception 'illegal_transition' using errcode = '22023';
  end if;

  -- Submitting requires a report path and locks it in.
  if p_new_status = 'submitted' then
    if p_report_path is null or length(p_report_path) = 0 then
      raise exception 'report_path_required' using errcode = '22023';
    end if;
    update public.inspections
      set status = p_new_status,
          report_pdf_path = p_report_path
      where id = p_inspection_id;
  else
    update public.inspections
      set status = p_new_status
      where id = p_inspection_id;
  end if;

  return json_build_object('ok', true, 'status', p_new_status);
end;
$$;

revoke all on function public.update_inspection_status(uuid, inspection_status, text) from public, anon;
grant execute on function public.update_inspection_status(uuid, inspection_status, text) to authenticated;

notify pgrst, 'reload schema';
