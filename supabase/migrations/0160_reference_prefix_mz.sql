-- ============================================================================
-- 0160 · The public reference says MZ, like the site it is printed on
--
-- `listing_reference_next()` (0152) emits "BT-00042" — Batta, the brand this
-- catalogue was built under. Two things are wrong with that now:
--
--   · It is the number a seller reads down the phone and an office quotes
--     back, printed on a page that says Mazed Immo everywhere else.
--   · The admin queue's search does not find it. It normalises whatever is
--     typed — "42", "mz 42", "MZ-00042" — into `MZ-` + five digits
--     (src/app/[locale]/admin/annonces/page.tsx), so searching a reference
--     has never matched a row. The code and the database disagreed about the
--     prefix, and the code is the one that matches the brand.
--
-- The mapping is 1:1 (BT-nnnnn → MZ-nnnnn) so `listings_reference_uniq` holds,
-- and the sequence is untouched: the next annonce continues the numbering.
--
-- `search_text` is a generated column that folds `reference` (0159), so every
-- row's search text is recomputed by this UPDATE — no reindex needed.
-- ============================================================================

-- Wrapped in one transaction by scripts/apply-migrations.mjs.
create or replace function public.listing_reference_next()
returns text
language sql
volatile
set search_path = public
as $$
  select 'MZ-' || lpad(nextval('public.listing_reference_seq')::text, 5, '0');
$$;

-- Guard: refuse rather than collide if an MZ- reference somehow already exists
-- for a different row than the BT- one that would become it.
do $$
declare v_collisions int;
begin
  select count(*) into v_collisions
    from public.listings b
   where b.reference like 'BT-%'
     and exists (
       select 1 from public.listings m
        where m.reference = 'MZ-' || substring(b.reference from 4)
     );
  if v_collisions > 0 then
    raise exception 'refusing: % BT- reference(s) would collide with an existing MZ- reference', v_collisions;
  end if;
end $$;

update public.listings
   set reference = 'MZ-' || substring(reference from 4)
 where reference like 'BT-%';

comment on column public.listings.reference is
  'Human-readable public reference (MZ-00042). Shown on the annonce and searchable in the admin.';

notify pgrst, 'reload schema';
