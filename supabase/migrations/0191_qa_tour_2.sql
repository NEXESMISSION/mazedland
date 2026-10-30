-- ============================================================================
-- 0191 · The second wave of the QA tour (2026-10-30), in the data layer.
--
-- 1. request_account_deletion() of 0190 aborted for any buyer who had ever
--    sent a visit request: it set visit_requests.buyer_phone to null and the
--    column was NOT NULL, so the whole deletion rolled back and the person
--    got a 500. The column may be null now (a visit keeps its slot, not the
--    person), the agence's client cards (leads) lose the person too, and
--    every demande of theirs loses its note, not only the live ones.
--
-- 2. claim_listing_place() counted only the free places under its lock; an
--    agence plan's quota was checked in TypeScript before the call, so N
--    submits at once all passed. It now takes the plan too (the agence, its
--    owner, its quota) and locks on the agence: members publish under
--    different seller ids.
--
-- 3. A signed-in person could rewrite every column of their own notification
--    rows through PostgREST (re-trigger an SMS, forge a kind, a text, a
--    link): the only column that is theirs is read_at.
--
-- 4. _notify_admins() told every admin everything; a member scoped to
--    « annonces » learned about pending agences and payments and got bell
--    links to pages their scope hides. The kind decides the section, and
--    only the members whose scope covers it (or the full admins) are told.
--
-- 5. payments_self_insert let a signed-in person write their own pending
--    payment — any kind, any amount, any plan — for the console to accept.
--    Every legitimate payment is written by the server (service role).
--
-- 6. The shop-documents and property-documents buckets took any file of any
--    size: images and PDFs, 10 MB, like receipts.
--
-- 7. The routes checked, then inserted: two requests at the same moment made
--    two agences for one owner, two pending plan payments, two pending
--    placements for one annonce. One each, enforced by the table.
--
-- Rollback: supabase/rollbacks/0191_qa_tour_2.down.sql.
-- ============================================================================

-- ── 1. A visit keeps its slot, not the person ───────────────────────────────
alter table public.visit_requests alter column buyer_phone drop not null;
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.visit_requests'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%buyer_phone%'
  loop
    execute format('alter table public.visit_requests drop constraint %I', c);
  end loop;
end $$;
alter table public.visit_requests
  add constraint visit_requests_buyer_phone_check
  check (buyer_phone is null or char_length(buyer_phone) between 8 and 24);

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
     set status = 'archived',
         contact_name = null,
         contact_phone = null,
         contact_whatsapp = null
   where seller_id = v_uid;

  -- Their demandes stop matching and leave the agences' radar; every note
  -- they wrote goes, whatever the demande's status.
  update public.property_requests
     set note = null
   where user_id = v_uid;
  update public.property_requests
     set status = 'paused', alerts = false
   where user_id = v_uid and status = 'active';

  -- Their visit requests keep the slot history, not the person; the client
  -- cards an agence made from them neither.
  update public.visit_requests
     set buyer_name = 'Compte supprimé', buyer_phone = null, message = null
   where buyer_id = v_uid;
  update public.leads
     set name = 'Compte supprimé', phone = null
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

-- ── 2. One place, taken once — the agence's plan too ────────────────────────
-- 'ok' when the status was flipped, 'not_submittable' when the annonce is not
-- the seller's or not in a starting status, 'taken_down' when an admin
-- removed it, 'full' when the places are taken: the free ones (p_limit) or
-- the agence's (p_shop_limit, counted over the agence's annonces and its
-- owner's own ones, as the Pro dashboard counts them).
drop function if exists public.claim_listing_place(uuid, uuid, text[], public.listing_status, int);

create or replace function public.claim_listing_place(
  p_listing    uuid,
  p_seller     uuid,
  p_from       text[],
  p_to         public.listing_status,
  p_limit      int default null,
  p_shop       uuid default null,
  p_shop_owner uuid default null,
  p_shop_limit int default null
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
  -- One seller at a time, and one agence at a time: two submits queue here
  -- instead of both counting the same places. Seller first, then agence,
  -- always in this order, so two sessions never wait for each other.
  perform pg_advisory_xact_lock(hashtext('listing_place:' || p_seller::text));
  if p_shop is not null then
    perform pg_advisory_xact_lock(hashtext('listing_place:shop:' || p_shop::text));
  end if;

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

  if p_shop is not null and p_shop_limit is not null then
    select count(*) into v_live
      from public.listings
     where (shop_id = p_shop or (shop_id is null and p_shop_owner is not null and seller_id = p_shop_owner))
       and id <> p_listing
       and status in ('published', 'pending_review');
    if v_live >= p_shop_limit then
      return 'full';
    end if;
  end if;

  update public.listings
     set status = p_to
   where id = p_listing;
  return 'ok';
end;
$$;

revoke execute on function public.claim_listing_place(uuid, uuid, text[], public.listing_status, int, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_listing_place(uuid, uuid, text[], public.listing_status, int, uuid, uuid, int) to service_role;

-- ── 3. A person's own notification rows: read_at and nothing else ───────────
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

-- ── 4. Admins are told what their scope covers ──────────────────────────────
create or replace function public._notify_admins(p_kind text, p_title text, p_body text, p_link text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count   int := 0;
  v_section text;
begin
  -- The console section the kind belongs to (src/lib/admin/sections.ts).
  -- Kinds with no section — a site error, a QA report — are for the full
  -- admins only.
  v_section := case
    when p_kind like 'admin_listing%' then 'annonces'
    when p_kind like 'admin_shop%' then 'agences'
    when p_kind in ('admin_receipt_pending', 'admin_clawback_owed', 'admin_payout_pending', 'admin_final_payment_overdue') then 'paiements'
    when p_kind like 'admin_social%' then 'social'
    when p_kind like 'admin_sms%' or p_kind like 'admin_email%' then 'notifications'
    else null
  end;

  insert into public.notifications (user_id, kind, title, body, link, payload)
  select p.id, p_kind, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb)
    from public.profiles p
   where p.role = 'admin'
     and p.banned_at is null
     and p.deleted_at is null
     and (p.admin_scopes is null or (v_section is not null and v_section = any (p.admin_scopes)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ── 5. Payments are written by the server ───────────────────────────────────
drop policy if exists payments_self_insert on public.payments;

-- ── 6. What the document buckets accept ─────────────────────────────────────
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/*', 'application/pdf']
 where id in ('shop-documents', 'property-documents');

-- ── 7. One each ─────────────────────────────────────────────────────────────
create unique index if not exists shops_one_live_per_owner
  on public.shops (owner_id)
  where status in ('pending', 'approved', 'suspended');
create unique index if not exists payments_one_pending_subscription
  on public.payments (user_id)
  where status = 'pending' and kind = 'subscription';
create unique index if not exists payments_one_pending_promo
  on public.payments ((metadata->>'listing_id'))
  where status = 'pending' and kind = 'promo';

notify pgrst, 'reload schema';
