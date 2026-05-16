-- ============================================================================
-- Storage buckets + access policies for Batta.tn
--
-- Three buckets, each with a different access posture:
--
--   properties            public-read, owner-write   — listing photos
--   kyc                   private; owner + admin     — CIN, selfie, financials
--   inspector-credentials private; owner + admin     — diplomas, insurance
--
-- We use storage.foldername(name) to scope by user uid prefix:
-- every uploaded path looks like `<auth.uid>/<filename>` so per-user
-- write is enforced by simple folder-name comparison.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('properties', 'properties', true),
  ('kyc', 'kyc', false),
  ('inspector-credentials', 'inspector-credentials', false)
on conflict (id) do nothing;

-- ─── properties (public read; owner uploads) ────────────────────────────────

drop policy if exists "properties_public_read" on storage.objects;
create policy "properties_public_read"
on storage.objects for select
using (bucket_id = 'properties');

drop policy if exists "properties_owner_write" on storage.objects;
create policy "properties_owner_write"
on storage.objects for insert
with check (
  bucket_id = 'properties'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "properties_owner_update" on storage.objects;
create policy "properties_owner_update"
on storage.objects for update
using (
  bucket_id = 'properties'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "properties_owner_delete" on storage.objects;
create policy "properties_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'properties'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ─── kyc (private; owner reads own, admin reads all) ────────────────────────

drop policy if exists "kyc_owner_read" on storage.objects;
create policy "kyc_owner_read"
on storage.objects for select
using (
  bucket_id = 'kyc'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "kyc_owner_insert" on storage.objects;
create policy "kyc_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'kyc'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ─── inspector-credentials (private; same posture as kyc) ───────────────────

drop policy if exists "inspector_creds_owner_read" on storage.objects;
create policy "inspector_creds_owner_read"
on storage.objects for select
using (
  bucket_id = 'inspector-credentials'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "inspector_creds_owner_insert" on storage.objects;
create policy "inspector_creds_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'inspector-credentials'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);
