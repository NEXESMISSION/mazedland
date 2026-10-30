-- ============================================================================
-- 0202 · Photos are create-only for their owner; the Activité section reads
--        the names it shows.
--
-- 0195 dropped the owner's UPDATE on the properties bucket, and the final
-- regression run (2026-10-30) swapped a reviewed photo anyway: remove, then
-- create under the same name. The browser never deletes a photo itself —
-- the server does, on the service role, when an annonce or a photo goes —
-- so the owner's DELETE goes too. (The receipts bucket keeps its owner
-- delete: the checkout removes what it uploaded when the payment fails.)
--
-- profiles_self_read (0195) listed the sections whose pages show a person;
-- « activity » shows who did what, and a member holding only that section
-- saw a log with no names. Added.
--
-- Rollback: supabase/rollbacks/0202_photos_create_only.down.sql.
-- ============================================================================

drop policy if exists properties_owner_delete on storage.objects;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select
  using (
    auth.uid() = id
    or public.admin_can('vendeurs') or public.admin_can('paiements') or public.admin_can('agences')
    or public.admin_can('demandes') or public.admin_can('annonces') or public.admin_can('resultats')
    or public.admin_can('notifications') or public.admin_can('equipe') or public.admin_can('activity')
  );

notify pgrst, 'reload schema';
