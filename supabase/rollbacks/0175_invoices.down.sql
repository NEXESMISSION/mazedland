-- Rollback of 0175 · invoices. Deletes every issued invoice and its numbering:
-- an invoice already sent to a client must then be reissued by hand. Take
-- `node scripts/backup-db.mjs` first.
drop trigger if exists _issue_invoice_on_capture on public.payments;
drop function if exists public._issue_invoice_on_capture();
drop function if exists public.issue_invoice(uuid);
drop function if exists public._invoice_label(public.payments);
drop table if exists public.invoices;
drop sequence if exists public.invoice_number_seq;
