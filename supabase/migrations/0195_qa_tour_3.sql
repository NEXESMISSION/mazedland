-- ============================================================================
-- 0195 · The data layer, after the third wave of the QA tour (2026-10-30).
--
-- 1. Listings are written by the server only — in fact, now. The browser
--    never writes a listing (every path is an API route on the service
--    role), yet `authenticated` held INSERT and UPDATE on the whole table,
--    and 0176's trigger guarded the status only: a seller could set shop_id
--    (an annonce under another agence's name and badge), fee_payment_id (a
--    free place), the promo flags, the view counters and the expiry on a
--    draft through PostgREST, and the submit never looked again. Revoked.
--    Five audit columns nobody but the console reads are no longer readable
--    by anonymous or signed-in clients either.
--
-- 2. is_admin() reads profiles, not the JWT: it trusted the app_metadata
--    claim first, so a member removed from the team (profiles.role set
--    back to individual) stayed a full admin for the database until their
--    auth record was edited by hand. A suspended or deleted admin is none.
--
-- 3. The console's sections are enforced by the database too. The
--    policies and the two SECURITY DEFINER gates tested is_admin(); a
--    member scoped to « popups » read every phone number, every receipt,
--    every notification, edited profiles and annonces and could broadcast,
--    with a direct REST call. admin_can(section) (0178) now decides where
--    the section is clear; a full admin (scopes null) passes everywhere.
--
-- 4. A person's own profile: phone, banned_at, banned_reason and deleted_at
--    are server-only (the phone is what an OTP verified; the ban is the
--    console's). _guard_profile_self_update() refuses them.
--
-- 5. Photos are create-only for their owner: the UPDATE policy on the
--    properties bucket let a seller swap the file of a reviewed photo in
--    place. The unused kyc and inspector-credentials buckets take no new
--    file. listing_reference_next() is the server's.
--
-- 6. The plan descriptions still said « boutique ».
--
-- Rollback: supabase/rollbacks/0195_qa_tour_3.down.sql.
-- ============================================================================

-- ── 1. Listings: the server writes, the client reads what it may ─────────────
revoke insert, update on public.listings from authenticated, anon;
revoke select (reviewed_by, reviewed_at, fee_waived_by, seller_credit_id, taken_down_by)
  on public.listings from anon, authenticated;

-- ── 2. is_admin() from the profile ──────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role::text = 'admin'
       and banned_at is null
       and deleted_at is null
  );
$$;

-- ── 3. Sections, at the database ────────────────────────────────────────────
-- Reading: an admin of a moderation or money section reads profiles (names,
-- phones); the sections that never show a person do not.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select
  using (
    auth.uid() = id
    or public.admin_can('vendeurs') or public.admin_can('paiements') or public.admin_can('agences')
    or public.admin_can('demandes') or public.admin_can('annonces') or public.admin_can('resultats')
    or public.admin_can('notifications') or public.admin_can('equipe')
  );
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all
  using (public.admin_can('vendeurs'))
  with check (public.admin_can('vendeurs'));

drop policy if exists listings_admin_all on public.listings;
create policy listings_admin_all on public.listings for all
  using (public.admin_can('annonces'))
  with check (public.admin_can('annonces'));

drop policy if exists listing_photos_owner_write on public.listing_photos;
create policy listing_photos_owner_write on public.listing_photos for all
  using (exists (select 1 from public.listings l where l.id = listing_photos.listing_id and (l.seller_id = auth.uid() or public.admin_can('annonces'))))
  with check (exists (select 1 from public.listings l where l.id = listing_photos.listing_id and (l.seller_id = auth.uid() or public.admin_can('annonces'))));

drop policy if exists notifications_admin_read on public.notifications;
create policy notifications_admin_read on public.notifications for select
  using (public.admin_can('notifications'));
drop policy if exists notifications_admin_delete on public.notifications;
create policy notifications_admin_delete on public.notifications for delete
  using (public.admin_can('notifications'));

drop policy if exists popups_admin_all on public.popups;
create policy popups_admin_all on public.popups for all
  using (public.admin_can('popups'))
  with check (public.admin_can('popups'));
drop policy if exists popup_views_self_rw on public.popup_views;
create policy popup_views_self_rw on public.popup_views for all
  using (user_id = auth.uid() or public.admin_can('popups'))
  with check (user_id = auth.uid() or public.admin_can('popups'));

drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all
  using (public.admin_can('catalogue'))
  with check (public.admin_can('catalogue'));
drop policy if exists category_attributes_admin_write on public.category_attributes;
create policy category_attributes_admin_write on public.category_attributes for all
  using (public.admin_can('catalogue'))
  with check (public.admin_can('catalogue'));

drop policy if exists seller_badges_admin_write on public.seller_badges;
create policy seller_badges_admin_write on public.seller_badges for all
  using (public.admin_can('paiements'))
  with check (public.admin_can('paiements'));

drop policy if exists contact_reveals_admin_read on public.contact_reveals;
create policy contact_reveals_admin_read on public.contact_reveals for select to authenticated
  using (public.admin_can('resultats'));
drop policy if exists listing_views_admin_read on public.listing_views;
create policy listing_views_admin_read on public.listing_views for select to authenticated
  using (public.admin_can('resultats'));
drop policy if exists watchlist_self_read on public.watchlist;
create policy watchlist_self_read on public.watchlist for select
  using (auth.uid() = user_id or public.admin_can('resultats'));

-- The two gates that answered to any admin: the same bodies, the section asked.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'broadcast_notification' and p.pronargs = 6;
  if d is null then raise exception 'broadcast_notification(6 args) not found'; end if;
  if position('not public.is_admin()' in d) = 0 then raise exception 'broadcast_notification: gate not found'; end if;
  execute replace(d, 'not public.is_admin()', 'not public.admin_can(''notifications'')');

  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_listing_payment' and p.pronargs = 2;
  if d is null then raise exception 'reject_listing_payment(2 args) not found'; end if;
  if position('not public.is_admin()' in d) = 0 then raise exception 'reject_listing_payment: gate not found'; end if;
  execute replace(d, 'not public.is_admin()', 'not public.admin_can(''paiements'')');
end $$;

-- ── 4. A person's own profile ───────────────────────────────────────────────
create or replace function public._guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- The server and the trusted triggers decide on their own: the API route
  -- in front of a service-role write has already checked who is asking.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;

  -- Console access — being an admin, and which sections — and the accounts
  -- of console members are a full admin's business only.
  if ((new.role = 'admin') is distinct from (old.role = 'admin')
      or new.admin_scopes is distinct from old.admin_scopes
      or (old.role = 'admin' and old.id is distinct from auth.uid()))
     and not public.is_full_admin() then
    raise exception 'forbidden: only a full admin manages the console team';
  end if;

  if public.is_admin() then return new; end if;

  -- The phone is what an OTP verified; the ban and the deletion are the
  -- server's. A person changing them through PostgREST pointed their SMS at
  -- any number or lifted their own suspension (the QA tour, 2026-10-30).
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.phone is distinct from old.phone
     or new.banned_at is distinct from old.banned_at
     or new.banned_reason is distinct from old.banned_reason
     or new.deleted_at is distinct from old.deleted_at
     or new.kyc_status is distinct from old.kyc_status
     or new.kyc_submitted_at is distinct from old.kyc_submitted_at
     or new.kyc_verified_at is distinct from old.kyc_verified_at
     or new.trust_score is distinct from old.trust_score then
    raise exception 'forbidden: cannot change protected column without admin';
  end if;

  return new;
end;
$function$;

-- ── 5. Storage and the reference counter ────────────────────────────────────
drop policy if exists properties_owner_update on storage.objects;
drop policy if exists kyc_owner_insert on storage.objects;
drop policy if exists inspector_creds_owner_insert on storage.objects;
drop policy if exists receipts_owner_read on storage.objects;
create policy receipts_owner_read on storage.objects for select
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.admin_can('paiements')));
drop policy if exists kyc_owner_read on storage.objects;
create policy kyc_owner_read on storage.objects for select
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_full_admin()));
drop policy if exists inspector_creds_owner_read on storage.objects;
create policy inspector_creds_owner_read on storage.objects for select
  using (bucket_id = 'inspector-credentials' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_full_admin()));

revoke execute on function public.listing_reference_next() from public, anon, authenticated;
grant execute on function public.listing_reference_next() to service_role;

-- ── 6. The plans' words ─────────────────────────────────────────────────────
update public.products
   set description = replace(description, 'Une boutique', 'Une agence'),
       description_ar = replace(description_ar, 'بوتيك', 'وكالة')
 where kind::text = 'subscription';

notify pgrst, 'reload schema';
