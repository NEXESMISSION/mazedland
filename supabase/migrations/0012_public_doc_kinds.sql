-- ============================================================================
-- Public document-kinds view — closes a UX hole opened by audit #25.
--
-- The property_documents RLS hides the entire row from non-owner /
-- non-admin / non-deposit users. As a side effect the auction detail
-- renders "No documents uploaded yet." for anonymous browsers — even
-- when the listing has a full file set. That kills the "documents
-- verified" social-proof signal that motivates deposit-locking.
--
-- Expose ONLY the kind name + the property pointer (no storage_path,
-- no uploaded_at). Public read is safe — these are titles like
-- "Titre foncier" / "Permis de bâtir" which are part of the listing
-- promise, not the actual sensitive PDF.
-- ============================================================================

create or replace view public.property_document_kinds as
select id, property_id, kind
from public.property_documents;

grant select on public.property_document_kinds to anon, authenticated;

notify pgrst, 'reload schema';
