-- Rollback of 0195 · the client may write listings again (0157's grants), the
-- audit columns are readable again, is_admin() trusts the JWT claim again,
-- the policies and the two gates answer to any admin again, the profile
-- guard protects what 0178 protected, the photo and legacy bucket policies
-- come back, listing_reference_next() is public again. The plan descriptions
-- keep « agence ».

grant insert, update on public.listings to authenticated;
grant select (reviewed_by, reviewed_at, fee_waived_by, seller_credit_id, taken_down_by)
  on public.listings to anon, authenticated;

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) then
    return true;
  end if;
  if v_uid is null then
    return false;
  end if;
  select role::text into v_role from public.profiles where id = v_uid;
  return coalesce(v_role = 'admin', false);
end;
$$;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (auth.uid() = id or public.is_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists listings_admin_all on public.listings;
create policy listings_admin_all on public.listings for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists listing_photos_owner_write on public.listing_photos;
create policy listing_photos_owner_write on public.listing_photos for all
  using (exists (select 1 from public.listings l where l.id = listing_photos.listing_id and (l.seller_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.listings l where l.id = listing_photos.listing_id and (l.seller_id = auth.uid() or public.is_admin())));
drop policy if exists notifications_admin_read on public.notifications;
create policy notifications_admin_read on public.notifications for select using (public.is_admin());
drop policy if exists notifications_admin_delete on public.notifications;
create policy notifications_admin_delete on public.notifications for delete using (public.is_admin());
drop policy if exists popups_admin_all on public.popups;
create policy popups_admin_all on public.popups for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists popup_views_self_rw on public.popup_views;
create policy popup_views_self_rw on public.popup_views for all
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists category_attributes_admin_write on public.category_attributes;
create policy category_attributes_admin_write on public.category_attributes for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists seller_badges_admin_write on public.seller_badges;
create policy seller_badges_admin_write on public.seller_badges for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists contact_reveals_admin_read on public.contact_reveals;
create policy contact_reveals_admin_read on public.contact_reveals for select to authenticated using (public.is_admin());
drop policy if exists listing_views_admin_read on public.listing_views;
create policy listing_views_admin_read on public.listing_views for select to authenticated using (public.is_admin());
drop policy if exists watchlist_self_read on public.watchlist;
create policy watchlist_self_read on public.watchlist for select using (auth.uid() = user_id or public.is_admin());

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'broadcast_notification' and p.pronargs = 6;
  execute replace(d, 'not public.admin_can(''notifications'')', 'not public.is_admin()');
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_listing_payment' and p.pronargs = 2;
  execute replace(d, 'not public.admin_can(''paiements'')', 'not public.is_admin()');
end $$;

create or replace function public._guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;
  if ((new.role = 'admin') is distinct from (old.role = 'admin')
      or new.admin_scopes is distinct from old.admin_scopes
      or (old.role = 'admin' and old.id is distinct from auth.uid()))
     and not public.is_full_admin() then
    raise exception 'forbidden: only a full admin manages the console team';
  end if;
  if public.is_admin() then return new; end if;
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.kyc_status is distinct from old.kyc_status
     or new.kyc_submitted_at is distinct from old.kyc_submitted_at
     or new.kyc_verified_at is distinct from old.kyc_verified_at
     or new.trust_score is distinct from old.trust_score then
    raise exception 'forbidden: cannot change protected column without admin';
  end if;
  return new;
end;
$function$;

create policy properties_owner_update on storage.objects for update
  using (bucket_id = 'properties' and (storage.foldername(name))[1] = auth.uid()::text);
create policy kyc_owner_insert on storage.objects for insert
  with check (bucket_id = 'kyc' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
create policy inspector_creds_owner_insert on storage.objects for insert
  with check (bucket_id = 'inspector-credentials' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists receipts_owner_read on storage.objects;
create policy receipts_owner_read on storage.objects for select
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists kyc_owner_read on storage.objects;
create policy kyc_owner_read on storage.objects for select
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists inspector_creds_owner_read on storage.objects;
create policy inspector_creds_owner_read on storage.objects for select
  using (bucket_id = 'inspector-credentials' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

grant execute on function public.listing_reference_next() to anon, authenticated;

notify pgrst, 'reload schema';
