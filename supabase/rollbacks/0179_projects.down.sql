-- Rollback of 0179 · projects and their units. Deletes every project and unit
-- (cover images stay in storage under the agence's uploads). Take
-- `node scripts/backup-db.mjs` first.
drop trigger if exists _touch_project_units on public.project_units;
drop trigger if exists _touch_projects on public.projects;
drop table if exists public.project_units;
drop table if exists public.projects;
notify pgrst, 'reload schema';
