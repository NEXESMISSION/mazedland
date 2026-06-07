-- ============================================================================
-- MONETIZATION — make the platform commission admin-parametrable (project rule:
-- never hardcode fees; route through app_settings).
--
-- batta_commission_rate() returned a hardcoded 0.05. It now reads app_settings
-- key='commission' (value shape {"rate": 0.05}) with a 0.05 fallback, so an
-- admin can change the cut without a migration — matching how deposit/listing
-- fees already work. A regex guard makes a malformed admin value fall back to
-- the default rather than erroring inside seller_earnings/seller_balance.
--
-- Was IMMUTABLE; now STABLE (it reads a table). All callers (seller_earnings,
-- seller_balance) are already STABLE, so this composes cleanly.
-- ============================================================================

create or replace function public.batta_commission_rate()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select (value ->> 'rate')::numeric
        from public.app_settings
       where key = 'commission'
         and (value ->> 'rate') ~ '^[0-9]+(\.[0-9]+)?$'
       limit 1
    ),
    0.05::numeric
  );
$$;

-- Seed the row so the admin settings UI has something to edit (no-op if the
-- key already exists). Keeps the documented 5% default explicit in data.
insert into public.app_settings (key, value)
values ('commission', '{"rate": 0.05}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
