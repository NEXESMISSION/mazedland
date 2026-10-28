-- ============================================================================
-- 0189 · « Sauvegarde » from the console.
--
-- A full admin downloads a copy of the data in one tap (/admin/settings):
-- every table of the `public` schema, row for row, the same content as
-- scripts/backup-db.mjs. The `auth` schema (password hashes) stays out.
--
-- The site reaches the database through PostgREST, which cannot list tables
-- or read one by name, hence two functions for the server only (service
-- role): the list of tables, and one table as JSON. The file is written to a
-- private bucket, `backups`, and handed over with a link valid ten minutes;
-- the route keeps the last ten files there.
--
-- Rollback: supabase/rollbacks/0189_admin_backup.down.sql.
-- ============================================================================

create or replace function public.admin_backup_tables()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select table_name::text
    from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
   order by 1;
$$;

create or replace function public.admin_backup_table(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' and table_name = p_table
  ) then
    raise exception 'unknown table %', p_table using errcode = '42P01';
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', p_table) into v;
  return v;
end;
$$;

revoke execute on function public.admin_backup_tables() from public, anon, authenticated;
revoke execute on function public.admin_backup_table(text) from public, anon, authenticated;
grant execute on function public.admin_backup_tables() to service_role;
grant execute on function public.admin_backup_table(text) to service_role;

-- Private: no policy at all, so only the service role reads or writes it.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
