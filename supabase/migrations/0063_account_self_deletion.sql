-- 0063: account self-deletion (GDPR / right-to-erasure)
--
-- Users had no way to delete their own account. For a service that stores
-- national-ID photos + phone numbers that's a real compliance gap.
--
-- Design: SOFT delete, not a row delete. profiles.id is referenced
-- ON DELETE RESTRICT by payments/properties, and bids/auctions hang off the
-- user — a hard delete would either fail or corrupt auction history. Instead
-- we scrub every piece of PII (profile + KYC submission + the private KYC
-- storage objects, purged by the caller) and tombstone the row with
-- deleted_at. The auth user is anonymised + banned by the API layer.
--
-- Guarded: deletion is refused while money is in flight, so a seller can't
-- vanish mid-auction and a winner can't walk away from an unpaid balance.
-- The function returns { ok:false, blockers:[...] } in that case and mutates
-- nothing.

alter table public.profiles
  add column if not exists deleted_at timestamptz;

create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_blockers text[] := '{}';
  v_paths   text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Idempotent: a second call after a successful delete is a no-op.
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is not null) then
    return jsonb_build_object('ok', true, 'already', true, 'kyc_paths', '[]'::jsonb);
  end if;

  -- 1) Seller with an auction that is scheduled/live/extending.
  if exists (
    select 1
    from public.auctions a
    join public.properties p on p.id = a.property_id
    where p.owner_id = v_uid
      and a.status::text in ('scheduled', 'live', 'extending')
  ) then
    v_blockers := array_append(v_blockers, 'active_listings');
  end if;

  -- 2) Winner who still owes the final balance.
  if exists (
    select 1
    from public.auctions a
    where a.winner_user_id = v_uid
      and a.status::text in ('ended_sold', 'sixth_offer_window', 'awarded')
      and not exists (
        select 1 from public.payments pm
        where pm.auction_id = a.id
          and pm.kind::text in ('final_payment', 'buy_now')
          and pm.status::text = 'captured'
      )
  ) then
    v_blockers := array_append(v_blockers, 'unpaid_win');
  end if;

  -- 3) A payment of theirs is still pending / under review.
  if exists (
    select 1 from public.payments
    where user_id = v_uid and status::text in ('pending', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'pending_payments');
  end if;

  -- 4) A seller payout owed to them is still in flight.
  if exists (
    select 1 from public.seller_payouts
    where seller_id = v_uid and status::text in ('pending', 'processing')
  ) then
    v_blockers := array_append(v_blockers, 'pending_payout');
  end if;

  if array_length(v_blockers, 1) is not null then
    return jsonb_build_object('ok', false, 'blockers', to_jsonb(v_blockers));
  end if;

  -- Collect KYC storage paths so the API can purge the private objects.
  select coalesce(array_agg(p), '{}')
    into v_paths
  from (
    select unnest(array[
      nullif(id_front_url, ''), nullif(id_back_url, ''),
      nullif(selfie_video_url, ''), nullif(selfie_image_url, '')
    ]) as p
    from public.kyc_submissions
    where user_id = v_uid
  ) s
  where p is not null and p not like 'http%';

  -- Scrub KYC PII (keep the row id for audit, drop the personal data).
  update public.kyc_submissions
     set full_name        = null,
         id_front_url     = '',
         id_back_url      = '',
         selfie_video_url = null,
         selfie_image_url = null,
         rejection_reason = null
   where user_id = v_uid;

  -- Scrub profile PII + tombstone. Row stays (FK ON DELETE RESTRICT) so
  -- auction/bid history keeps referential integrity; nothing identifying left.
  update public.profiles
     set full_name   = null,
         phone       = null,
         governorate = null,
         deleted_at  = now()
   where id = v_uid;

  return jsonb_build_object('ok', true, 'kyc_paths', to_jsonb(v_paths));
end;
$$;

revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;
