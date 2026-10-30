-- Rollback of 0192 · issue_credit_note returns to its 0187 shape: a credit
-- note cancels the plan period and revokes the pack's credits, and no longer
-- stops a placement or a badge. Placements and badges already stopped by a
-- credit note stay stopped (the seller was refunded for them).

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
