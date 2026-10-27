-- ============================================================================
-- 0178 · The console team: sections per member, and an audit trail
--
-- Until now every console account could do everything. The owner wants to
-- hand the moderation queue to one person and the payments to another
-- without either reaching the rest. Every member keeps `role = 'admin'` (all
-- the RLS written against is_admin() keeps working for them); what narrows a
-- member is `admin_scopes`: null is the whole console, a list is just those
-- sections (names in src/lib/admin/sections.ts).
--
-- The console checks the sections on every page and route. Here the database
-- checks them too where it matters most — money, prices, the journal and the
-- settings — so a member's token used outside the console gets no further:
--   is_full_admin()   an admin with the whole console
--   admin_can(s)      a full admin, or a member given section s
--
-- The profile guard learns the team: only a full admin makes or unmakes an
-- admin, changes anyone's sections, or touches another member's account. It
-- also trusts the service role now, as 0167 does for listings — every write
-- from the server comes after the API route checked who asked. Before this,
-- « changer le rôle » in /admin/vendeurs was refused by this very trigger.
--
-- admin_audit keeps who changed what, before and after, for the decisions
-- that cost money or access. Append-only: UPDATE, DELETE and TRUNCATE are
-- refused for everyone, the service role included. Only a full admin reads
-- it. Idempotent.
-- ============================================================================

alter table public.profiles add column if not exists admin_scopes text[];
comment on column public.profiles.admin_scopes is
  'Console sections this admin may open (src/lib/admin/sections.ts). NULL = the whole console. Only read when role = admin.';

-- ─── Who may do what ────────────────────────────────────────────────────────

create or replace function public.is_full_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
     and not exists (
       select 1 from public.profiles
        where id = auth.uid() and admin_scopes is not null
     );
$$;

create or replace function public.admin_can(p_section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
     and not exists (
       select 1 from public.profiles
        where id = auth.uid()
          and admin_scopes is not null
          and not (p_section = any (admin_scopes))
     );
$$;

grant execute on function public.is_full_admin() to anon, authenticated, service_role;
grant execute on function public.admin_can(text) to anon, authenticated, service_role;

-- ─── The profile guard ─────────────────────────────────────────────────────

create or replace function public._guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The server and the trusted triggers decide on their own: the API route
  -- in front of a service-role write has already checked who is asking.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;

  -- Console access — being an admin, and which sections — and the accounts
  -- of console members are a full admin's business only.
  if ((new.role = 'admin') is distinct from (old.role = 'admin')
      or new.admin_scopes is distinct from old.admin_scopes
      or (old.role = 'admin' and old.id is distinct from auth.uid()))
     and not public.is_full_admin() then
    raise exception 'forbidden: only a full admin manages the console team';
  end if;

  if public.is_admin() then return new; end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.kyc_status is distinct from old.kyc_status
     or new.kyc_submitted_at is distinct from old.kyc_submitted_at
     or new.kyc_verified_at is distinct from old.kyc_verified_at
     or new.trust_score is distinct from old.trust_score then
    raise exception 'forbidden: cannot change protected column without admin';
  end if;

  return new;
end;
$$;

-- ─── Money, prices, the journal and the settings, by section ───────────────

drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
  for all using (public.is_full_admin()) with check (public.is_full_admin());

drop policy if exists payments_self on public.payments;
create policy payments_self on public.payments
  for select using ((auth.uid() = user_id) or public.admin_can('paiements'));

drop policy if exists seller_credits_own_read on public.seller_credits;
create policy seller_credits_own_read on public.seller_credits
  for select using ((seller_id = auth.uid()) or public.admin_can('paiements'));

drop policy if exists seller_credits_admin_write on public.seller_credits;
create policy seller_credits_admin_write on public.seller_credits
  for all using (public.admin_can('paiements')) with check (public.admin_can('paiements'));

drop policy if exists credit_ledger_own_read on public.credit_ledger;
create policy credit_ledger_own_read on public.credit_ledger
  for select using (
    public.admin_can('paiements')
    or exists (
      select 1 from public.seller_credits c
       where c.id = credit_ledger.seller_credit_id and c.seller_id = auth.uid()
    )
  );

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all using (public.admin_can('offres')) with check (public.admin_can('offres'));

drop policy if exists activity_log_admin_read on public.activity_log;
create policy activity_log_admin_read on public.activity_log
  for select using (public.admin_can('activity'));

-- ─── The audit trail ───────────────────────────────────────────────────────

create table if not exists public.admin_audit (
  id          bigint generated always as identity primary key,
  -- No foreign key: deleting an account must not rewrite its entries.
  actor_id    uuid,
  action      text not null check (char_length(action) between 1 and 80),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id   text check (target_id is null or char_length(target_id) <= 120),
  before      jsonb,
  after       jsonb,
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit (target_type, target_id, created_at desc);
create index if not exists admin_audit_actor_idx on public.admin_audit (actor_id, created_at desc);

alter table public.admin_audit enable row level security;
revoke all on table public.admin_audit from anon, authenticated;
grant select on table public.admin_audit to authenticated;
grant select, insert on table public.admin_audit to service_role;

drop policy if exists admin_audit_full_admin_read on public.admin_audit;
create policy admin_audit_full_admin_read on public.admin_audit
  for select to authenticated using (public.is_full_admin());

-- Append-only. The one way out is a direct database session that sets
-- app.audit_cleanup — how the end-to-end tests remove their [TEST] entries;
-- no RPC opens it.
create or replace function public._admin_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.audit_cleanup', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'admin_audit is append-only';
end;
$$;

drop trigger if exists admin_audit_append_only on public.admin_audit;
create trigger admin_audit_append_only
  before update or delete on public.admin_audit
  for each row execute function public._admin_audit_append_only();

drop trigger if exists admin_audit_no_truncate on public.admin_audit;
create trigger admin_audit_no_truncate
  before truncate on public.admin_audit
  for each statement execute function public._admin_audit_append_only();

notify pgrst, 'reload schema';
