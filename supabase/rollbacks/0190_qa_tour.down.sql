-- Rollback of 0190 · the takedown columns go (an admin's takedown becomes a
-- plain « archived » again), claim_listing_place() goes (the code of 0190
-- needs it: roll the code back first), request_account_deletion() returns to
-- its 0153 version (an account deleted meanwhile keeps the cascade already
-- applied), and the buckets accept anything again.

alter table public.listings
  drop column if exists taken_down_reason,
  drop column if exists taken_down_by,
  drop column if exists taken_down_at;

drop function if exists public.claim_listing_place(uuid, uuid, text[], public.listing_status, int);

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
     set status = 'archived'
   where seller_id = v_uid and status <> 'archived';
  update public.profiles
     set deleted_at = now(),
         full_name  = 'Compte supprimé',
         phone      = null
   where id = v_uid;
  return jsonb_build_object('ok', true, 'kyc_paths', '[]'::jsonb);
end;
$$;

update storage.buckets set file_size_limit = null, allowed_mime_types = null where id in ('properties', 'receipts');

notify pgrst, 'reload schema';
