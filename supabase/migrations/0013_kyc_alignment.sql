-- ============================================================================
-- Batta.tn — kyc_submissions column alignment for the new multi-step
-- KYC flow ported from mazed-auto.
--
-- The original schema (0001_init.sql) used:
--    cin_front_path, cin_back_path, selfie_path, financial_proof_path
--
-- The new flow (kyc/processing/page.tsx) writes:
--    id_front_url, id_back_url, selfie_video_url, selfie_image_url
--
-- We rename the existing columns (keeping their data — no production
-- data yet, but the rename is forward-compatible), add the two new
-- selfie columns, add `full_name` for the seller-name match later,
-- and add a UNIQUE constraint on user_id so upsert(onConflict=user_id)
-- works in the processing page.
-- ============================================================================

alter table public.kyc_submissions
  rename column cin_front_path to id_front_url;
alter table public.kyc_submissions
  rename column cin_back_path to id_back_url;

-- The old single `selfie_path` becomes the still-image slot; we also
-- need a separate slot for the liveness triptych. The new flow writes
-- to BOTH; the still is the headshot used for face-match, the triptych
-- is the multi-pose evidence admin reviews.
alter table public.kyc_submissions
  rename column selfie_path to selfie_image_url;
alter table public.kyc_submissions
  add column if not exists selfie_video_url text;

-- Snapshot of the user's name at submit time. Used by the admin queue
-- to spot mismatches against the CIN on the front photo OCR/eye-ball
-- check. Optional — older submissions stay null.
alter table public.kyc_submissions
  add column if not exists full_name text;

-- financial_proof_path is real-estate-specific; mazed-auto doesn't
-- have it. Keep the column (nullable) — it's already optional in the
-- old single-page form. Future "premium bidder" flow can require it.

-- The processing page uses .upsert(payload, { onConflict: 'user_id' }).
-- Without a unique index, supabase 400s. There may already be one
-- from a prior migration; the IF NOT EXISTS keeps the migration
-- idempotent.
create unique index if not exists kyc_submissions_user_id_unique
  on public.kyc_submissions(user_id);

-- The new flow stores Supabase Storage PATHS (not public URLs) in the
-- *_url columns — the kyc bucket is private and pages render the
-- files via signed URLs at admin-review time. The column name keeps
-- mazed-auto's convention for an easier port; the SEMANTIC content
-- is now "path inside the `kyc` bucket" rather than "public URL."

notify pgrst, 'reload schema';
