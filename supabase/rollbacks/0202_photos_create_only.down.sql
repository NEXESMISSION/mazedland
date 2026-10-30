-- Rollback of 0202 · the owner may delete their photos again (and so swap a
-- reviewed one by remove + create); the activity-only member loses the names.

create policy properties_owner_delete on storage.objects for delete
  using (bucket_id = 'properties' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select
  using (
    auth.uid() = id
    or public.admin_can('vendeurs') or public.admin_can('paiements') or public.admin_can('agences')
    or public.admin_can('demandes') or public.admin_can('annonces') or public.admin_can('resultats')
    or public.admin_can('notifications') or public.admin_can('equipe')
  );

notify pgrst, 'reload schema';
