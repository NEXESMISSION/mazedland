-- Rollback of 0198 · the constraint of 0193 comes back. Only with code that
-- names the relationship it embeds (src/lib/pro/shops.ts, loadPlanPeriods):
-- an unqualified `payment:payments (…)` is ambiguous again with it.

alter table public.shop_subscriptions
  add constraint shop_subscriptions_replaced_by_fkey
  foreign key (replaced_by) references public.payments(id) on delete set null;

notify pgrst, 'reload schema';
