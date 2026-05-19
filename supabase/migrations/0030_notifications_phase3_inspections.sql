-- ============================================================================
-- Batta.tn — Phase 3: in-app notifications for the inspection lifecycle.
--
-- Inspections are created and mutated through Supabase RLS directly
-- (no dedicated API routes), so we drive these notifications from a
-- single AFTER-INSERT/UPDATE trigger on public.inspections.
--
-- Events covered:
--   * INSERT with inspector_id set     → 'inspection_assigned' (inspector)
--                                       → 'inspection_requested' (requester)
--   * INSERT without inspector_id      → 'inspection_requested' (requester)
--   * inspector_id changes (assign)    → 'inspection_assigned' (new inspector)
--   * scheduled_at goes from null→set  → 'inspection_scheduled' (requester)
--   * status → 'submitted'             → 'inspection_completed' (requester)
--                                       → also property owner if different
--
-- The trigger uses public.enqueue_notification, which is SECURITY DEFINER
-- and runs as service_role, so RLS on notifications.INSERT isn't an issue.
-- ============================================================================

create or replace function public._on_inspection_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title       text;
  v_owner       uuid;
  v_link        text;
  v_kind        text;
begin
  -- Look up the property title + owner once per event. The link points
  -- to a generic inspection detail surface; the actual route can change
  -- without breaking the notification (clients tolerate 404s gracefully).
  select p.title, p.owner_id into v_title, v_owner
    from public.properties p where p.id = new.property_id;
  v_link := '/inspections/' || new.id::text;

  if tg_op = 'INSERT' then
    -- Requester receipt — always fire.
    perform public.enqueue_notification(
      new.requested_by,
      'inspection_requested',
      'Demande d''inspection envoyée',
      'Votre demande d''inspection pour ' ||
        coalesce('« ' || v_title || ' »', 'cette annonce') ||
        ' a été enregistrée.',
      v_link
    );

    -- If the inspector was set at creation time, also notify them.
    if new.inspector_id is not null then
      perform public.enqueue_notification(
        new.inspector_id,
        'inspection_assigned',
        'Nouvelle inspection à effectuer',
        'Une nouvelle inspection vous a été assignée sur ' ||
          coalesce('« ' || v_title || ' »', 'une annonce') || '.',
        v_link
      );
    end if;

    return new;
  end if;

  -- UPDATE branch — guard each event so we don't fire on unrelated row changes.

  -- 1) Inspector assigned (or re-assigned).
  if new.inspector_id is not null
     and (old.inspector_id is null or old.inspector_id is distinct from new.inspector_id) then
    perform public.enqueue_notification(
      new.inspector_id,
      'inspection_assigned',
      'Nouvelle inspection à effectuer',
      'Une nouvelle inspection vous a été assignée sur ' ||
        coalesce('« ' || v_title || ' »', 'une annonce') || '.',
      v_link
    );
  end if;

  -- 2) Scheduled time set or moved.
  if new.scheduled_at is not null
     and (old.scheduled_at is null or old.scheduled_at is distinct from new.scheduled_at) then
    perform public.enqueue_notification(
      new.requested_by,
      'inspection_scheduled',
      'Inspection planifiée',
      'Votre inspection pour ' ||
        coalesce('« ' || v_title || ' »', 'cette annonce') ||
        ' est planifiée le ' ||
        to_char(new.scheduled_at at time zone 'UTC', 'DD/MM/YYYY HH24:MI') || ' UTC.',
      v_link
    );
  end if;

  -- 3) Report submitted → notify requester (and property owner if different).
  if new.status = 'submitted'
     and (old.status is null or old.status is distinct from 'submitted') then
    perform public.enqueue_notification(
      new.requested_by,
      'inspection_completed',
      'Rapport d''inspection disponible',
      'Le rapport d''inspection pour ' ||
        coalesce('« ' || v_title || ' »', 'cette annonce') ||
        ' est prêt à être consulté.',
      v_link
    );
    if v_owner is not null and v_owner <> new.requested_by then
      perform public.enqueue_notification(
        v_owner,
        'inspection_completed',
        'Rapport d''inspection de votre bien',
        'Un rapport d''inspection vient d''être soumis pour ' ||
          coalesce('« ' || v_title || ' »', 'votre annonce') || '.',
        v_link
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_inspection_event on public.inspections;
create trigger on_inspection_event
  after insert or update on public.inspections
  for each row execute function public._on_inspection_event();

notify pgrst, 'reload schema';
