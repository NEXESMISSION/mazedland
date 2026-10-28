-- Rollback of 0186 · no more plan-ending reminders. Take `node scripts/backup-db.mjs` first.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-plan-reminders') then
    perform cron.unschedule('mazed-plan-reminders');
  end if;
end $$;
drop function if exists public.remind_plan_renewals();
alter table public.shop_subscriptions drop column if exists reminded_at;
notify pgrst, 'reload schema';
