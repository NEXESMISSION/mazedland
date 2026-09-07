-- ============================================================================
-- listing_photos.is_cover — which photo represents the annonce.
--
-- Auto has this column; Land's 0146 did not port it, and the gap was invisible
-- until the admin queue was ported and every query selecting `is_cover` failed
-- with `column listing_photos_1.is_cover does not exist`. The pages still
-- answered 200, because a streamed shell is sent before the query runs — which
-- is worth recording: HTTP 200 on a React Server Component says nothing about
-- whether its data layer works.
--
-- Until now "the cover" was implicitly `sort_order = 0`. That works right up to
-- the moment an admin wants a different photo first without reordering all of
-- them, which is exactly what the moderation pane offers. The backfill below
-- makes the existing implicit rule explicit, so nothing changes for the 29
-- listings that already exist.
-- ============================================================================

alter table public.listing_photos
  add column if not exists is_cover boolean not null default false;

-- One cover per listing. A partial unique index rather than a constraint:
-- rows with is_cover = false are ignored entirely, so a listing can hold any
-- number of ordinary photos and at most one cover.
create unique index if not exists listing_photos_one_cover
  on public.listing_photos (listing_id)
  where is_cover;

-- Backfill: the lowest sort_order becomes the cover, which is the rule the
-- code has been applying by hand. `distinct on` picks exactly one row per
-- listing, and the id tiebreak keeps it deterministic when two photos share a
-- sort_order.
with first_photo as (
  select distinct on (listing_id) id
    from public.listing_photos
   order by listing_id, sort_order, id
)
update public.listing_photos p
   set is_cover = true
  from first_photo f
 where p.id = f.id
   and not p.is_cover;

notify pgrst, 'reload schema';
