-- 0062: accent-insensitive property search
--
-- Today search uses plain ILIKE on title/governorate/address, so "Beja"
-- misses listings written "Béja" (and vice-versa) and "Medenine" misses
-- "Médenine". For a Tunisian/French catalogue that's a real miss rate.
--
-- Fix: a STORED generated column `search_text` on properties holding an
-- accent-folded, lower-cased concatenation of the searchable fields, plus a
-- trigram GIN index so substring ILIKE stays fast at scale. The app strips
-- accents off the user's term in JS (NFD + drop diacritics) before matching,
-- so both sides are diacritic-free.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent() is STABLE by default (it reads a dictionary), which bars it from
-- a generated column / index expression. This thin wrapper pins the dictionary
-- explicitly, which makes the result deterministic — safe to mark IMMUTABLE.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

alter table public.properties
  add column if not exists search_text text
  generated always as (
    public.f_unaccent(lower(
      coalesce(title, '') || ' ' ||
      coalesce(governorate, '') || ' ' ||
      coalesce(address, '') || ' ' ||
      coalesce(description, '')
    ))
  ) stored;

create index if not exists idx_properties_search_text_trgm
  on public.properties using gin (search_text extensions.gin_trgm_ops);
