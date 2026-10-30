-- Rollback of 0191 · the indexes go; the buckets accept anything again; the
-- self-insert policy of payments comes back as 0057 left it; every admin is
-- told everything again; a person may update their notification rows again;
-- claim_listing_place() returns to its 0190 shape (roll the code back first);
-- request_account_deletion() returns to its 0190 version. buyer_phone stays
-- nullable: rows anonymised meanwhile hold null, and 0190's deletion would
-- abort on them again.

drop index if exists public.payments_one_pending_promo;
drop index if exists public.payments_one_pending_subscription;
drop index if exists public.shops_one_live_per_owner;

update storage.buckets set file_size_limit = null, allowed_mime_types = null
 where id in ('shop-documents', 'property-documents');

drop policy if exists payments_self_insert on public.payments;
create policy payments_self_insert on public.payments for insert
  with check (auth.uid() = user_id and status = 'pending');

create or replace function public._notify_admins(p_kind text, p_title text, p_body text, p_link text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count int := 0;
begin
  insert into public.notifications (user_id, kind, title, body, link, payload)
  select p.id, p_kind, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb)
    from public.profiles p
   where p.role = 'admin';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

grant update on public.notifications to authenticated;

drop function if exists public.claim_listing_place(uuid, uuid, text[], public.listing_status, int, uuid, uuid, int);
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
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is not null) then
    return jsonb_build_object('ok', true, 'already', true, 'kyc_paths', '[]'::jsonb);
  end if;
  if exists (
    select 1 from public.payments
     where user_id = v_uid and status::text in ('pending', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'pending_payments');
  end if;
  if exists (
    select 1 from public.listings
     where seller_id = v_uid and status in ('pending_payment', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'active_listings');
  end if;
  if array_length(v_blockers, 1) > 0 then
    return jsonb_build_object('ok', false, 'blockers', to_jsonb(v_blockers));
  end if;
  update public.listings
     set status = 'archived', contact_name = null, contact_phone = null, contact_whatsapp = null
   where seller_id = v_uid;
  update public.property_requests
     set status = 'paused', alerts = false, note = null
   where user_id = v_uid and status = 'active';
  update public.visit_requests
     set buyer_name = 'Compte supprimé', buyer_phone = null, message = null
   where buyer_id = v_uid;
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
     set deleted_at = now(), full_name = 'Compte supprimé', phone = null
   where id = v_uid;
  return jsonb_build_object('ok', true, 'kyc_paths', '[]'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
