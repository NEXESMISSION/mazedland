-- Rollback of 0189 · the console's « Sauvegarde » stops working: its two
-- read functions go. The `backups` bucket is left in place — empty it from
-- the Supabase dashboard (Storage → backups) and delete it there if wanted;
-- Supabase refuses deleting storage rows from SQL.

drop function if exists public.admin_backup_table(text);
drop function if exists public.admin_backup_tables();

notify pgrst, 'reload schema';
