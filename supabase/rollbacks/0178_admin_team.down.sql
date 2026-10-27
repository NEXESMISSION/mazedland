-- Rollback of 0178 · the console team and the audit trail. Every console
-- member gets the whole console back (admin_scopes is dropped), the audit
-- entries are deleted, and the policies and the profile guard return to
-- their 0015/0016 form — including the guard refusing the service role, which
-- breaks « changer le rôle » in /admin/vendeurs again. Take
-- `node scripts/backup-db.mjs` first.

drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payments_self on public.payments;
create policy payments_self on public.payments
  for select using ((auth.uid() = user_id) or public.is_admin());

drop policy if exists seller_credits_own_read on public.seller_credits;
create policy seller_credits_own_read on public.seller_credits
  for select using ((seller_id = auth.uid()) or public.is_admin());

drop policy if exists seller_credits_admin_write on public.seller_credits;
create policy seller_credits_admin_write on public.seller_credits
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists credit_ledger_own_read on public.credit_ledger;
create policy credit_ledger_own_read on public.credit_ledger
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.seller_credits c
       where c.id = credit_ledger.seller_credit_id and c.seller_id = auth.uid()
    )
  );

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists activity_log_admin_read on public.activity_log;
create policy activity_log_admin_read on public.activity_log
  for select using (public.is_admin());

create or replace function public._guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;

  if current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;

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

drop trigger if exists admin_audit_no_truncate on public.admin_audit;
drop trigger if exists admin_audit_append_only on public.admin_audit;
drop function if exists public._admin_audit_append_only();
drop table if exists public.admin_audit;

drop function if exists public.admin_can(text);
drop function if exists public.is_full_admin();

alter table public.profiles drop column if exists admin_scopes;

notify pgrst, 'reload schema';
