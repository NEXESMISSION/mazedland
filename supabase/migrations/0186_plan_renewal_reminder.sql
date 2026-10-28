-- ============================================================================
-- 0186 · Remind an agence that its plan is ending
--
-- Since 2026-10-28 the same plan cannot be bought again while it runs, only in
-- its last days (Réglages → Publication → plan_renew_days, 5 by default). The
-- « Abonnement » tab says a notification will tell the owner when: this job
-- sends it, once, when the agence's last paid period enters those days and
-- nothing follows it. Kind « plan_expiring », to the agence's owner, in the
-- site and by SMS (src/lib/sms-kinds.ts), linking to the subscription tab.
-- Daily at 07:05 (Tunis is UTC+1: 08:05 there). Idempotent.
-- ============================================================================

alter table public.shop_subscriptions add column if not exists reminded_at timestamptz;

create or replace function public.remind_plan_renewals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days  int := greatest(1, public.setting_days('plan_renew_days', 5));
  v_count int := 0;
  r record;
begin
  for r in
    -- Each approved agence's last active period, when it ends within the
    -- renewal days and was not reminded yet.
    select distinct on (s.shop_id)
           s.id, s.shop_id, s.ends_at, s.reminded_at, sh.owner_id, sh.name shop_name, p.name_fr plan_name
      from public.shop_subscriptions s
      join public.shops sh on sh.id = s.shop_id and sh.status = 'approved'
      left join public.products p on p.id = s.product_id
     where s.status = 'active'
       and s.ends_at > now()
     order by s.shop_id, s.ends_at desc
  loop
    continue when r.reminded_at is not null
               or r.ends_at > now() + make_interval(days => v_days);
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      r.owner_id,
      'plan_expiring',
      'Votre abonnement se termine bientôt',
      format('L''abonnement %s de « %s » se termine le %s. Vous pouvez le renouveler dès maintenant.',
             coalesce(r.plan_name, ''), r.shop_name, to_char(r.ends_at at time zone 'Africa/Tunis', 'DD/MM/YYYY')),
      format('/pro/dashboard?shop=%s&tab=abonnement', r.shop_id),
      jsonb_build_object('vars', jsonb_build_object(
        'plan', coalesce(r.plan_name, ''),
        'shop', r.shop_name,
        'date', to_char(r.ends_at at time zone 'Africa/Tunis', 'DD/MM/YYYY')))
    );
    update public.shop_subscriptions set reminded_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.remind_plan_renewals() from public, anon, authenticated;
grant execute on function public.remind_plan_renewals() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-plan-reminders') then
    perform cron.unschedule('mazed-plan-reminders');
  end if;
  perform cron.schedule('mazed-plan-reminders', '5 7 * * *', 'select public.remind_plan_renewals();');
end $$;

notify pgrst, 'reload schema';
