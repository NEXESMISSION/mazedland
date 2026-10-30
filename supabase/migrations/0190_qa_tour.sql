-- ============================================================================
-- 0190 · What the QA tour of 2026-10-29 found in the data layer.
--
-- 1. An annonce an admin took down looked exactly like one the seller
--    withdrew (`archived` either way), so « Remettre en ligne » undid the
--    admin's decision with no moderation. `taken_down_*` records the takedown;
--    the seller's relist and renew refuse while it is set, and an admin's
--    approve / republish clears it.
--
-- 2. The free places were checked and then taken in two steps with no lock,
--    so two submits sent at the same moment both passed and three annonces
--    went live on two free places. claim_listing_place() counts and flips
--    the status in one transaction under an advisory lock, and only from the
--    statuses a submit, a relist or a renew may start from — which also stops
--    a double tap on « Publier » sending two notifications.
--
-- 3. Account deletion scrubbed the profile but not what it owned: the agence
--    stayed open with the person's phone, their demandes kept matching and
--    showing in the Pro radar, their name and number stayed on archived
--    annonces and visit requests. The deletion now takes those with it.
--
-- 4. The receipts and properties buckets accepted any file of any size; the
--    browser was the only limit. Images (and a PDF for a receipt), 10 MB.
--
-- Rollback: supabase/rollbacks/0190_qa_tour.down.sql.
-- ============================================================================

-- ── 1. An admin's takedown, recorded ─────────────────────────────────────────
alter table public.listings
  add column if not exists taken_down_at timestamptz,
  add column if not exists taken_down_by uuid references public.profiles(id) on delete set null,
  add column if not exists taken_down_reason text;

-- ── 2. One place, taken once ─────────────────────────────────────────────────
-- Returns 'ok' when the status was flipped, 'not_submittable' when the annonce
-- is not the seller's or not in a starting status (a double submit, a stale
-- tab), 'taken_down' when an admin removed it, 'full' when the free places
-- are taken. p_limit null means the place is covered by a plan or a credit and
-- only the status is at stake.
create or replace function public.claim_listing_place(
  p_listing uuid,
  p_seller  uuid,
  p_from    text[],
  p_to      public.listing_status,
  p_limit   int default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_taken  timestamptz;
  v_live   int;
begin
  -- One seller at a time: two submits of theirs queue here instead of both
  -- counting the same free places.
  perform pg_advisory_xact_lock(hashtext('listing_place:' || p_seller::text));

  select status::text, taken_down_at into v_status, v_taken
    from public.listings
   where id = p_listing and seller_id = p_seller
   for update;
  if v_status is null or not (v_status = any (p_from)) then
    return 'not_submittable';
  end if;
  if v_taken is not null then
    return 'taken_down';
  end if;

  if p_limit is not null then
    select count(*) into v_live
      from public.listings
     where seller_id = p_seller
       and id <> p_listing
       and status in ('published', 'pending_review');
    if v_live >= p_limit then
      return 'full';
    end if;
  end if;

  update public.listings
     set status = p_to
   where id = p_listing;
  return 'ok';
end;
$$;

revoke execute on function public.claim_listing_place(uuid, uuid, text[], public.listing_status, int) from public, anon, authenticated;
grant execute on function public.claim_listing_place(uuid, uuid, text[], public.listing_status, int) to service_role;

-- ── 3. Deleting an account takes what it owned with it ───────────────────────
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_blockers text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Idempotent: a second call after a successful delete is a no-op.
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is not null) then
    return jsonb_build_object('ok', true, 'already', true, 'kyc_paths', '[]'::jsonb);
  end if;

  -- A payment of theirs is still pending or under review. Deleting the account
  -- now would leave money in flight with nobody to answer for it.
  if exists (
    select 1 from public.payments
     where user_id = v_uid and status::text in ('pending', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'pending_payments');
  end if;

  -- An annonce of theirs is waiting for a payment or for a moderator.
  if exists (
    select 1 from public.listings
     where seller_id = v_uid and status in ('pending_payment', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'active_listings');
  end if;

  if array_length(v_blockers, 1) > 0 then
    return jsonb_build_object('ok', false, 'blockers', to_jsonb(v_blockers));
  end if;

  -- Their annonces come down with them, and their name and number go off
  -- them. Archived rather than deleted: the moderation log and any captured
  -- fee still point at these rows.
  update public.listings
     set status = case when status = 'archived' then status else 'archived' end,
         contact_name = null,
         contact_phone = null,
         contact_whatsapp = null
   where seller_id = v_uid;

  -- Their demandes stop matching and leave the agences' radar.
  update public.property_requests
     set status = 'paused', alerts = false, note = null
   where user_id = v_uid and status = 'active';

  -- Their visit requests keep the slot history, not the person.
  update public.visit_requests
     set buyer_name = 'Compte supprimé', buyer_phone = null, message = null
   where buyer_id = v_uid;

  -- An agence they own closes: nobody can manage it any more, and its page
  -- showed the erased person's phone and e-mail.
  update public.shop_subscriptions
     set status = 'cancelled'
   where status = 'active'
     and shop_id in (select id from public.shops where owner_id = v_uid);
  update public.shops
     set status = 'suspended',
         rejection_reason = coalesce(rejection_reason, 'Compte du propriétaire supprimé'),
         phone = null, email = null, website = null
   where owner_id = v_uid and status <> 'suspended';

  update public.profiles
     set deleted_at = now(),
         full_name  = 'Compte supprimé',
         phone      = null
   where id = v_uid;

  -- `kyc_paths` stays in the response shape so the API route needs no change;
  -- it is always empty now.
  return jsonb_build_object('ok', true, 'kyc_paths', '[]'::jsonb);
end;
$$;

-- ── 4. What the buckets accept ───────────────────────────────────────────────
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/*']
 where id = 'properties';
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/*', 'application/pdf']
 where id = 'receipts';

notify pgrst, 'reload schema';
