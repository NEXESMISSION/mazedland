-- Rollback of 0176 · signed-in sellers may write their own listings and
-- photos again, whatever the status, as 0146 and 0157 allowed. No data is
-- lost. Take `node scripts/backup-db.mjs` first.
drop trigger if exists _listing_photos_client_write_guard on public.listing_photos;
drop function if exists public._listing_photos_client_write_guard();
drop trigger if exists _listings_client_write_guard on public.listings;
drop function if exists public._listings_client_write_guard();
comment on column public.listings.pending_edit is
  'A seller''s edit of a published annonce waiting for an admin: { fields, photos, flags }. The annonce stays online unchanged meanwhile (0172).';
notify pgrst, 'reload schema';
