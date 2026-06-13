-- ============================================================================
-- AUCTION CONFIG (fix) — the format guard should gate only real SELLERS.
--
-- 0130 added _guard_auction_type_enabled to stop a Dutch/Sealed auction being
-- created while the admin has that format switched off. But it fired for EVERY
-- insert regardless of caller, which blocks legitimate non-seller paths:
--   • admin/service-role tooling that may create any format on purpose,
--   • the RPC integration fixtures (seeded via the service-role client),
--   • seed/migration scripts and SECURITY DEFINER callers.
--
-- The only actor we actually need to gate is a real seller creating their own
-- auction from the schedule form — that runs with the `authenticated` JWT role.
-- So: gate ONLY when auth.role() = 'authenticated'; bypass everything else.
-- A seller can never obtain the service_role key, so the security posture is
-- unchanged. coalesce() guards the null role of out-of-request (psql) contexts.
-- Idempotent (create or replace); the 0130 trigger keeps pointing here.
-- ============================================================================

create or replace function public._guard_auction_type_enabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_types jsonb;
begin
  -- Only gate real sellers (authenticated via PostgREST). Admin/service-role,
  -- seeders, migrations, SECURITY DEFINER, and system relists pass freely.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  -- System relists carry an already-valid format.
  if new.relisted_from_id is not null then
    return new;
  end if;
  -- English is the always-available standard format.
  if new.type = 'english' then
    return new;
  end if;
  select value into v_types from public.app_settings where key = 'auction_types';
  if new.type = 'dutch'  and coalesce((v_types->>'dutch_enabled')::boolean,  false) then
    return new;
  end if;
  if new.type = 'sealed' and coalesce((v_types->>'sealed_enabled')::boolean, false) then
    return new;
  end if;
  raise exception 'auction_type_disabled' using errcode = '23514';
end;
$$;

notify pgrst, 'reload schema';
