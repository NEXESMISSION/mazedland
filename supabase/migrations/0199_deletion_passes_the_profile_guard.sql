-- ============================================================================
-- 0199 · Account deletion passes the profile guard.
--
-- 0195 made phone, banned_at, banned_reason and deleted_at server-only in
-- _guard_profile_self_update(). request_account_deletion() is SECURITY
-- DEFINER but runs with the caller's JWT, so the trigger saw an
-- « authenticated » person setting phone to null and deleted_at to now()
-- — and refused: every deletion answered 500 from the moment 0195 ran
-- (the regression run of the QA tour, 2026-10-30, within the hour). The
-- function now raises the guard's own bypass for its transaction, as the
-- trusted triggers do, before it touches the profile.
--
-- Rollback: supabase/rollbacks/0199_deletion_passes_the_profile_guard.down.sql.
-- ============================================================================

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

  -- This function decides for the person; the profile guard (0195) must let
  -- it set the phone and the deletion mark it protects from the person's own
  -- hand. Local to the transaction.
  perform set_config('app.bypass_profile_guard', 'on', true);

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

notify pgrst, 'reload schema';
