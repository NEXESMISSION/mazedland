-- ============================================================================
-- Batta.tn — Two new gentle reminder pipelines:
--   1. kyc_pending_reminder — a user submitted KYC but the admin hasn't
--      decided after 24h. Reassures them their request is still in queue
--      and nudges admins indirectly (the user opens a support ticket
--      faster if they stay informed).
--   2. listing_unscheduled_reminder — a seller's auction listing was
--      approved (status='ready') but they never created the auctions row
--      (the scheduling step). 3 days of silence → ping them so it doesn't
--      get lost in the dashboard. Direct-sale listings auto-publish so
--      this only matters for listing_type='auction'.
--
-- Both pipelines use a "last reminded" column so a re-run of the cron
-- never double-sends. The HTTP endpoints driving them are wired in
-- src/app/api/cron/notifications/{kyc-pending,unscheduled}/route.ts.
-- ============================================================================

-- ─── 1. KYC pending reminder ───────────────────────────────────────────────

alter table public.profiles
  add column if not exists kyc_pending_reminded_at timestamptz;

create or replace function public.notify_kyc_pending_reminder()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_p     record;
  v_now   timestamptz := now();
begin
  for v_p in
    select id
      from public.profiles
     where kyc_status in ('submitted', 'pending')
       and kyc_submitted_at is not null
       and kyc_submitted_at < v_now - interval '24 hours'
       and kyc_pending_reminded_at is null
     for update
  loop
    perform public.enqueue_notification(
      v_p.id,
      'kyc_pending_reminder',
      'Vérification toujours en cours',
      'Votre dossier d''identité est toujours en cours d''examen. ' ||
        'Notre équipe le traite et vous recevrez une décision dans les prochaines heures.',
      '/kyc/status'
    );
    update public.profiles
       set kyc_pending_reminded_at = v_now
     where id = v_p.id;
    v_count := v_count + 1;
  end loop;

  return json_build_object('notified', v_count, 'at', v_now);
end;
$$;

revoke all on function public.notify_kyc_pending_reminder() from public;
grant execute on function public.notify_kyc_pending_reminder() to service_role;

-- Reset the reminder flag when KYC moves out of submitted/pending — so if a
-- user resubmits later they're eligible for another reminder. Lives in a
-- trigger so any path that flips kyc_status (admin verdict, user
-- resubmission) keeps the reminder window honest without re-implementing it.
create or replace function public._on_kyc_status_change_reset_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kyc_status is distinct from old.kyc_status
     and new.kyc_status not in ('submitted', 'pending')
     and old.kyc_pending_reminded_at is not null then
    new.kyc_pending_reminded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists kyc_status_change_reset_reminder on public.profiles;
create trigger kyc_status_change_reset_reminder
  before update of kyc_status on public.profiles
  for each row execute function public._on_kyc_status_change_reset_reminder();

-- ─── 2. Unscheduled approved listing reminder ──────────────────────────────

alter table public.properties
  add column if not exists unscheduled_reminded_at timestamptz;

create or replace function public.notify_unscheduled_listings()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_p     record;
  v_now   timestamptz := now();
begin
  for v_p in
    select p.id, p.owner_id, p.title
      from public.properties p
     where p.status = 'ready'
       and p.listing_type = 'auction'
       and p.updated_at < v_now - interval '3 days'
       and p.unscheduled_reminded_at is null
       and not exists (
         select 1 from public.auctions a
          where a.property_id = p.id
            and a.status in ('scheduled', 'live', 'extending',
                              'ended_sold', 'ended_unsold', 'awarded',
                              'sixth_offer_window')
       )
     for update
  loop
    perform public.enqueue_notification(
      v_p.owner_id,
      'listing_unscheduled_reminder',
      'Programmez votre enchère',
      coalesce('« ' || v_p.title || ' »', 'Votre annonce') ||
        ' est validée mais pas encore mise en ligne. ' ||
        'Programmez la date de l''enchère pour qu''elle apparaisse sur Batta.',
      '/sell/' || v_p.id::text || '/schedule'
    );
    update public.properties
       set unscheduled_reminded_at = v_now
     where id = v_p.id;
    v_count := v_count + 1;
  end loop;

  return json_build_object('notified', v_count, 'at', v_now);
end;
$$;

revoke all on function public.notify_unscheduled_listings() from public;
grant execute on function public.notify_unscheduled_listings() to service_role;

-- Reset the reminder flag when the seller actually creates the auction row,
-- so if they un-schedule and re-approve later they can be reminded again.
create or replace function public._on_auction_insert_reset_unscheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.properties
     set unscheduled_reminded_at = null
   where id = new.property_id
     and unscheduled_reminded_at is not null;
  return new;
end;
$$;

drop trigger if exists auction_insert_reset_unscheduled on public.auctions;
create trigger auction_insert_reset_unscheduled
  after insert on public.auctions
  for each row execute function public._on_auction_insert_reset_unscheduled();

notify pgrst, 'reload schema';
