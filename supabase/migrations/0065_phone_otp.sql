-- 0065: phone OTP store (WinSMS verification)
--
-- Phone numbers were never verified — anyone could register a number they
-- don't own, and since phone is a login alias (phone → email lookup) that's a
-- real spoofing vector.
--
-- The other group app stored OTP codes in an in-memory Map, which silently
-- breaks on serverless (each invocation is a fresh process — the code set on
-- instance A is gone when verify lands on instance B). We store them in
-- Postgres instead so send + verify survive across instances.
--
-- Codes are stored HASHED (sha256(code + phone + pepper), computed in the API
-- layer); the plaintext never touches the DB. RLS is on with NO policies, so
-- only the service-role API can read/write — never the client.

create table if not exists public.phone_otps (
  phone        text primary key,
  code_hash    text        not null,
  expires_at   timestamptz not null,
  attempts     int         not null default 0,
  send_count   int         not null default 1,
  window_start timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.phone_otps enable row level security;
-- No policies on purpose: service-role bypasses RLS; everyone else is denied.

-- Housekeeping: drop rows whose code has been expired for over a day so the
-- table stays tiny. Scheduled via pg_cron if available.
create or replace function public.cleanup_phone_otps()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.phone_otps where expires_at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cleanup_phone_otps() from public;
grant execute on function public.cleanup_phone_otps() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'batta-cleanup-otps') then
      perform cron.unschedule('batta-cleanup-otps');
    end if;
    perform cron.schedule(
      'batta-cleanup-otps',
      '17 3 * * *',
      $cron$ select public.cleanup_phone_otps(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
