-- ============================================================================
-- 0181 · The two other annonces the new thin_text rule flags
--
-- After 0180, MZ-00040 (description « ممتاز ») and MZ-00039 (« terain
-- agricol ») were still online with a description that says nothing. The
-- owner asked for them to go through review too (2026-10-27). Back to the
-- admin's queue with the reason; nothing deleted, an admin approves them
-- again in /admin/annonces once the text says something. Idempotent.
-- ============================================================================

update public.listings
   set status = 'pending_review', review_flags = array['thin_text']::text[]
 where reference in ('MZ-00040', 'MZ-00039') and status = 'published';
