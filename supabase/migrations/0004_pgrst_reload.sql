-- Force PostgREST to drop its schema cache and re-introspect on the next
-- request. Without this, freshly-created tables sometimes stay 404 from
-- the REST API for several minutes after `supabase db push` completes.
notify pgrst, 'reload schema';
