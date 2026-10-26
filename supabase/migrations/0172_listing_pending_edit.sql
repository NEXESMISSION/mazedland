-- ============================================================================
-- 0172 · Editing an annonce that is already online
--
-- Until now a published annonce could not be edited at all: the wizard only
-- reopens drafts, so a seller who wanted to lower the price had to withdraw
-- and publish again. Editing in place, without a check, would be the other
-- mistake — on a property site that is the difference between a price
-- correction and a bait-and-switch.
--
-- An edit is checked by the same rules as a new annonce (contacts in the
-- text, banned words, implausible price, duplicates, photos, trusted seller):
--   • clean → it replaces the annonce at once, which stays online;
--   • flagged → it waits here, in `pending_edit`, with its reasons, while the
--     annonce stays online as it was. An admin applies it or turns it down.
--
-- `pending_edit` holds the full proposed version (fields and photos), so what
-- an admin approves is exactly what the seller sent. Not granted to the
-- client roles (0157 grants listings column by column). Idempotent.
-- ============================================================================

alter table public.listings
  add column if not exists pending_edit    jsonb,
  add column if not exists pending_edit_at timestamptz;

create index if not exists listings_pending_edit_idx
  on public.listings (pending_edit_at)
  where pending_edit is not null;

comment on column public.listings.pending_edit is
  'A seller''s edit of a published annonce waiting for an admin: { fields, photos, flags }. The annonce stays online unchanged meanwhile (0172).';
