-- ============================================================================
-- Batta.tn — Drop the `delegation` column from properties.
--
-- The sell form has been simplified: governorate + address is enough for
-- buyer-facing geography (the address line already captures sub-district
-- detail when the seller wants to share it). Carrying a separate
-- `delegation` column was extra clutter on the form and in every place
-- that displays property location — drop it everywhere.
--
-- `if exists` so re-applying on a project that already ran this is a
-- no-op rather than a hard error.
-- ============================================================================

alter table public.properties
  drop column if exists delegation;

notify pgrst, 'reload schema';
