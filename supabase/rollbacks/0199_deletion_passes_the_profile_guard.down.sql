-- Rollback of 0199 · request_account_deletion() without the guard bypass, as
-- 0191 wrote it. With 0195's guard in place every deletion fails again: roll
-- 0195 back first, or do not roll this one back.

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
  update public.property_requests set note = null where user_id = v_uid;
  update public.property_requests set status = 'paused', alerts = false where user_id = v_uid and status = 'active';
  update public.visit_requests
     set buyer_name = 'Compte supprimé', buyer_phone = null, message = null
   where buyer_id = v_uid;
  update public.leads set name = 'Compte supprimé', phone = null where buyer_id = v_uid;
  update public.shop_subscriptions
     set status = 'cancelled'
   where status = 'active' and shop_id in (select id from public.shops where owner_id = v_uid);
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
