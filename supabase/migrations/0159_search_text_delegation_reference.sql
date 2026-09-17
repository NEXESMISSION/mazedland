-- ============================================================================
-- 0159 · search_text: the delegation and the reference
--
-- `search_text` (0146) folds title, governorate, address and description. Two
-- things a buyer can see on the card were missing from it:
--
--   · `delegation` — the line every card and hero prints as the location
--     ("Sakiet Ezzit"). Searching for the delegation returned nothing.
--   · `reference`  — "BT-00002", the number a seller reads out on the phone and
--     the office quotes back. Searching for it returned nothing.
--
-- A generated column's expression cannot be altered in place, so the column is
-- dropped and rebuilt. Three things have to come back with it: the trigram
-- index the catalogue's ILIKE uses, and the SELECT grants 0146/0157 gave the
-- two client roles on this column (a dropped column takes its grants with it).
--
-- Checked before writing this: no view and no RLS policy reads search_text, and
-- public.f_unaccent is IMMUTABLE, which a generated column requires.
-- ============================================================================

begin;

drop index if exists public.listings_search_idx;

alter table public.listings drop column if exists search_text;

alter table public.listings
  add column search_text text generated always as (
    public.f_unaccent(lower(
      coalesce(title, '') || ' ' || coalesce(governorate, '') || ' ' ||
      coalesce(delegation, '') || ' ' || coalesce(address, '') || ' ' ||
      coalesce(description, '') || ' ' || coalesce(reference, '')
    ))
  ) stored;

create index listings_search_idx on public.listings using gin (search_text gin_trgm_ops);

grant select (search_text) on public.listings to anon, authenticated;

commit;
