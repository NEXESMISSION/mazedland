-- ============================================================================
-- Batta.tn — Notifications: self-delete + auto-archive of stale reads.
--
-- Adds:
--   * `notifications_self_delete` RLS policy — users can delete their own
--     notifications. The bell now offers per-row × and "Tout supprimer",
--     and both call DELETE through this policy.
--   * `prune_read_notifications()` SECURITY DEFINER function + a daily
--     pg_cron job that wipes notifications older than 30 days that have
--     already been read. Keeps the bell list usable without forcing the
--     user to mass-delete by hand.
-- ============================================================================

-- ─── RLS: per-row owner delete ────────────────────────────────────────────
-- The admin-delete policy from 0033 still applies to admins; this one is
-- the user-level grant so the bell can clear an item the user no longer
-- wants to see. Both are FOR DELETE, so they OR together.

drop policy if exists notifications_self_delete on public.notifications;
create policy notifications_self_delete on public.notifications
  for delete using (auth.uid() = user_id);

-- ─── Auto-archive ─────────────────────────────────────────────────────────
-- Drop already-read notifications older than 30 days. Unread items are
-- preserved so a long-absent user still sees the queue waiting for them.
-- SECURITY DEFINER so pg_cron's superuser context can call it without
-- per-row RLS overhead; the function only deletes rows that pass the
-- read+age filter so it can't be abused to mass-wipe arbitrary data.

create or replace function public.prune_read_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  delete from public.notifications
    where read_at is not null
      and read_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_read_notifications() from public;
grant execute on function public.prune_read_notifications() to service_role;

-- ─── Schedule the daily prune (pg_cron required) ──────────────────────────
-- 03:30 UTC = 04:30 Africa/Tunis (no DST). Off-peak so the DELETE
-- doesn't fight bid traffic. Mirrors the auction-tick / ending-soon
-- schedule blocks (see 0022, 0031) so the cron table stays uniform.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'batta-prune-notifications') then
      perform cron.unschedule('batta-prune-notifications');
    end if;
    perform cron.schedule(
      'batta-prune-notifications',
      '30 3 * * *',
      $cron$ select public.prune_read_notifications(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
