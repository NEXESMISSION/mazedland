-- Rollback of 0187 · only possible while no credit note exists: a credit note
-- issued is a numbered accounting document and is never deleted. Take
-- `node scripts/backup-db.mjs` first.
do $$
begin
  if exists (select 1 from public.invoices where doc_type = 'credit_note') then
    raise exception 'credit notes exist: they are kept, the rollback stops here';
  end if;
end $$;
drop function if exists public.issue_credit_note(uuid, text, uuid);
alter table public.invoices drop constraint if exists invoices_credit_note_shape;
alter table public.invoices drop constraint if exists invoices_doc_type_check;
alter table public.invoices add constraint invoices_doc_type_check check (doc_type = any (array['invoice', 'receipt']));
alter table public.invoices drop constraint if exists invoices_credits_invoice_id_key;
alter table public.invoices drop column if exists reason;
alter table public.invoices drop column if exists credits_invoice_id;
alter table public.invoices alter column payment_id set not null;
notify pgrst, 'reload schema';
