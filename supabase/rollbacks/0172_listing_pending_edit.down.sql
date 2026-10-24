-- Rollback of 0172: edits waiting for an admin are lost (the annonces
-- themselves are untouched — a pending edit never changed them).
drop index if exists public.listings_pending_edit_idx;
alter table public.listings
  drop column if exists pending_edit,
  drop column if exists pending_edit_at;
