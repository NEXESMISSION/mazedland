-- ============================================================================
-- Batta.tn — rename kyc_submissions.reviewer_notes → rejection_reason.
--
-- The original 0001 schema (ported from a generic admin-review template)
-- called the free-text reviewer column `reviewer_notes`. Every consumer
-- in this codebase — the admin queue page (admin/kyc-queue/page.tsx),
-- the queue list UI, the shared TS types, and the new /kyc/processing
-- submit payload — uses `rejection_reason`. Renaming aligns the DB with
-- the dominant code convention rather than touching N files of TS.
-- ============================================================================

alter table public.kyc_submissions
  rename column reviewer_notes to rejection_reason;

notify pgrst, 'reload schema';
