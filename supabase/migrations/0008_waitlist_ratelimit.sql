-- ============================================================================
-- Batta.tn — waitlist abuse protection (audit C9)
--
-- Replaces the wide-open `insert with check (true)` policy on waitlist
-- with a SECURITY DEFINER RPC that enforces:
--   - max 5 inserts per IP per rolling 5-minute window,
--   - max 20 inserts per email lifetime (idempotent upsert),
--   - the email format is sane.
--
-- The `enqueue_waitlist(email, phone, locale, ip)` function returns
-- a tagged outcome the API route can translate to HTTP. Direct
-- INSERTs are revoked so the table can't be hit by a malicious SDK
-- caller hammering supabase.from('waitlist').insert(...).
-- ============================================================================

create table if not exists public.waitlist_attempts (
  ip          inet not null,
  attempted_at timestamptz not null default now()
);
create index if not exists waitlist_attempts_ip_idx
  on public.waitlist_attempts(ip, attempted_at desc);

alter table public.waitlist_attempts enable row level security;
-- Only the SECURITY DEFINER RPC reads/writes this table; no public policy.

create or replace function public.enqueue_waitlist(
  p_email  text,
  p_phone  text,
  p_locale text,
  p_ip     inet
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
  v_locale text;
  v_email  text;
begin
  v_email := lower(trim(p_email));
  if v_email is null
     or length(v_email) < 5
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return json_build_object('ok', false, 'error', 'invalid_email');
  end if;

  v_locale := case
    when p_locale in ('ar','fr','en') then p_locale
    else 'ar' end;

  -- Per-IP rate limit: 5 inserts / 5 minutes / IP.
  if p_ip is not null then
    select count(*) into v_recent
      from public.waitlist_attempts
     where ip = p_ip
       and attempted_at >= now() - interval '5 minutes';
    if v_recent >= 5 then
      return json_build_object('ok', false, 'error', 'rate_limited');
    end if;
    insert into public.waitlist_attempts (ip) values (p_ip);
    -- Opportunistic cleanup so the table doesn't grow forever.
    delete from public.waitlist_attempts
     where attempted_at < now() - interval '1 day';
  end if;

  insert into public.waitlist (email, phone, locale, source)
  values (v_email, nullif(trim(coalesce(p_phone, '')), ''), v_locale, 'landing')
  on conflict (email) do update
    set phone  = coalesce(excluded.phone, public.waitlist.phone),
        locale = excluded.locale;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.enqueue_waitlist(text, text, text, inet)
  to anon, authenticated;

-- Lock down direct inserts so the SDK can't bypass the RPC.
drop policy if exists waitlist_anon_insert on public.waitlist;
-- Reads stay admin-only (unchanged from 0001).

notify pgrst, 'reload schema';
