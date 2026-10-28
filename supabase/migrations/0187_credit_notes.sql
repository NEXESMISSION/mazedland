-- ============================================================================
-- 0187 · Credit notes (factures d'avoir)
--
-- An invoice is never deleted and its number never reused: the series stays
-- unbroken. A payment accepted by mistake — on 2026-10-28 a Pro 59 DT test
-- with no receipt became MZ-2026-000005 — is cancelled by a credit note: a
-- document of its own, numbered in the same series, with the same amounts
-- negative, pointing at the invoice it cancels (one credit note per invoice).
--
-- issue_credit_note(invoice, reason, actor), called by the console with the
-- service role, in one transaction:
--   1. the credit note (issuer and client copied from the invoice);
--   2. the payment → refunded (it no longer counts as received);
--   3. what the payment bought stops: the plan period it granted is
--      cancelled, a pack's credits are revoked;
--   4. a line in admin_audit.
-- A second call returns the same credit note. Idempotent migration.
-- ============================================================================

alter table public.invoices alter column payment_id drop not null;
alter table public.invoices add column if not exists credits_invoice_id uuid references public.invoices(id) on delete restrict;
alter table public.invoices add column if not exists reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_credits_invoice_id_key') then
    alter table public.invoices add constraint invoices_credits_invoice_id_key unique (credits_invoice_id);
  end if;
end $$;

alter table public.invoices drop constraint if exists invoices_doc_type_check;
alter table public.invoices add constraint invoices_doc_type_check
  check (doc_type = any (array['invoice', 'receipt', 'credit_note']));

-- A credit note cancels an invoice and belongs to no payment of its own; every
-- other document belongs to exactly one payment.
alter table public.invoices drop constraint if exists invoices_credit_note_shape;
alter table public.invoices add constraint invoices_credit_note_shape check (
  (doc_type = 'credit_note' and credits_invoice_id is not null and payment_id is null)
  or (doc_type <> 'credit_note' and credits_invoice_id is null and payment_id is not null)
);

create or replace function public.issue_credit_note(p_invoice_id uuid, p_reason text, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv  public.invoices;
  v_id   uuid;
  v_year text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'invoice_not_found'; end if;
  if v_inv.doc_type = 'credit_note' then raise exception 'not_an_invoice'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select id into v_id from public.invoices where credits_invoice_id = v_inv.id;
  if v_id is not null then return v_id; end if;

  v_year := to_char(now() at time zone 'Africa/Tunis', 'YYYY');
  insert into public.invoices (payment_id, credits_invoice_id, reason, user_id, number, doc_type,
                               amount_ttc, vat_rate, amount_ht, vat_amount, label, issuer, client)
  values (
    null, v_inv.id, left(trim(p_reason), 300), v_inv.user_id,
    'MZ-' || v_year || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'),
    'credit_note',
    -v_inv.amount_ttc, v_inv.vat_rate, -v_inv.amount_ht, -v_inv.vat_amount,
    'Avoir sur ' || v_inv.number || ' — ' || v_inv.label,
    v_inv.issuer, v_inv.client
  )
  returning id into v_id;

  update public.payments
     set status = 'refunded',
         admin_notes = left(coalesce(admin_notes || ' · ', '') || 'Avoir : ' || trim(p_reason), 1000)
   where id = v_inv.payment_id and status = 'captured';

  update public.shop_subscriptions set status = 'cancelled'
   where payment_id = v_inv.payment_id and status = 'active';
  update public.seller_credits set status = 'revoked'
   where payment_id = v_inv.payment_id and status = 'active';

  insert into public.admin_audit (actor_id, action, target_type, target_id, note, after)
  values (p_actor, 'invoice.credit_note', 'invoice', v_inv.id::text, trim(p_reason),
          jsonb_build_object('credit_note_id', v_id, 'invoice', v_inv.number));

  return v_id;
end;
$$;

revoke execute on function public.issue_credit_note(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_credit_note(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
