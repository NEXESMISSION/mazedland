-- ============================================================================
-- 0175 · Invoices — one per captured payment, numbered by the database
--
-- Cahier global V1, P4. Every payment that reaches `captured` — a listing fee,
-- a pack, a Pro plan, a placement, a badge, whichever route captured it — gets
-- one document, numbered in one unbroken sequence: MZ-2026-000001, …
--
-- What the document says is copied from app_settings AT ISSUE TIME, never
-- read again later: the company's name, tax number (matricule fiscal) and
-- address, and the VAT rate. A later change of address must not rewrite an
-- invoice already sent. Until the company's name and tax number are filled in
-- (/admin/site → Réglages), the document is issued as a « reçu de paiement »
-- (`doc_type = receipt`), not a tax invoice: the site does not invent a legal
-- identity.
--
-- Amounts are what was paid (TTC). With a VAT rate set, the HT and VAT parts
-- are derived and stored, to the millime.
--
-- Server only (service role); pages read through it. Idempotent.
-- ============================================================================

create sequence if not exists public.invoice_number_seq;

create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null unique references public.payments(id) on delete restrict,
  user_id      uuid references public.profiles(id) on delete set null,
  number       text not null unique,
  doc_type     text not null check (doc_type in ('invoice', 'receipt')),
  issued_at    timestamptz not null default now(),
  amount_ttc   numeric(12, 3) not null,
  vat_rate     numeric(5, 2),
  amount_ht    numeric(12, 3),
  vat_amount   numeric(12, 3),
  label        text not null,
  -- The issuer and the client as they were when it was issued.
  issuer       jsonb not null default '{}',
  client       jsonb not null default '{}'
);
create index if not exists invoices_user_idx on public.invoices (user_id, issued_at desc);

alter table public.invoices enable row level security;
revoke all on table public.invoices from anon, authenticated;

-- What a payment bought, in words for the line of the invoice.
create or replace function public._invoice_label(p public.payments)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select pr.name_fr from public.products pr where pr.id::text = p.metadata->>'product_id'),
    case p.kind::text
      when 'listing_fee'  then 'Frais de publication d''annonce'
      when 'listing_pack' then 'Forfait de publications'
      when 'subscription' then 'Abonnement Mazed Immo Pro'
      when 'promo'        then 'Mise en avant d''annonce'
      when 'badge'        then 'Badge vendeur vérifié'
      when 'renewal'      then 'Renouvellement d''annonce'
      else 'Service Mazed Immo'
    end
  )
  || coalesce(' — « ' || (select l.title from public.listings l where l.id::text = p.metadata->>'listing_id') || ' »', '');
$$;

-- Issue the document for a captured payment, once. Safe to call twice.
create or replace function public.issue_invoice(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay      public.payments;
  v_id       uuid;
  v_settings jsonb;
  v_name     text;
  v_tax_id   text;
  v_rate     numeric;
  v_ht       numeric;
  v_client   jsonb;
  v_year     text;
begin
  select id into v_id from public.invoices where payment_id = p_payment_id;
  if v_id is not null then return v_id; end if;

  select * into v_pay from public.payments where id = p_payment_id;
  if v_pay.id is null or v_pay.status::text <> 'captured' then return null; end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_settings
    from public.app_settings
   where key in ('company_name', 'company_tax_id', 'company_address', 'invoice_vat_rate');
  v_name   := nullif(trim(v_settings->>'company_name'), '');
  v_tax_id := nullif(trim(v_settings->>'company_tax_id'), '');
  v_rate   := nullif(v_settings->>'invoice_vat_rate', '')::numeric;
  if v_rate is not null and (v_rate < 0 or v_rate > 50) then v_rate := null; end if;

  -- The client: the payer, and for a Pro plan the shop's legal identity.
  select jsonb_build_object(
           'name', p.full_name,
           'phone', p.phone,
           'shop', s.name,
           'legal_name', s.legal_name,
           'legal_id', s.legal_id
         )
    into v_client
    from public.profiles p
    left join public.shops s on s.id::text = v_pay.metadata->>'shop_id'
   where p.id = v_pay.user_id;

  v_year := to_char(now() at time zone 'Africa/Tunis', 'YYYY');
  if v_rate is not null then
    v_ht := round(v_pay.amount / (1 + v_rate / 100), 3);
  end if;

  insert into public.invoices (payment_id, user_id, number, doc_type, amount_ttc, vat_rate, amount_ht, vat_amount, label, issuer, client)
  values (
    v_pay.id,
    v_pay.user_id,
    'MZ-' || v_year || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'),
    case when v_name is not null and v_tax_id is not null then 'invoice' else 'receipt' end,
    v_pay.amount,
    v_rate,
    v_ht,
    case when v_ht is not null then v_pay.amount - v_ht end,
    public._invoice_label(v_pay),
    jsonb_build_object('name', coalesce(v_name, 'Mazed Immo'), 'tax_id', v_tax_id, 'address', nullif(trim(v_settings->>'company_address'), '')),
    coalesce(v_client, '{}'::jsonb)
  )
  on conflict (payment_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.invoices where payment_id = p_payment_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.issue_invoice(uuid) from public, anon, authenticated;
-- The server (service role) may reissue one that a failing trigger missed.
grant execute on function public.issue_invoice(uuid) to service_role;

-- Whatever captured it — the receipt queue, an admin marking a fee paid, a
-- future gateway — the document follows. A failure here never blocks the
-- capture itself: the invoice can be issued again by calling issue_invoice.
create or replace function public._issue_invoice_on_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'captured' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    begin
      perform public.issue_invoice(new.id);
    exception when others then
      raise warning 'issue_invoice(%) failed: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists _issue_invoice_on_capture on public.payments;
create trigger _issue_invoice_on_capture
  after insert or update of status on public.payments
  for each row execute function public._issue_invoice_on_capture();

-- Payments captured before this migration get theirs, in the order they were made.
do $$
declare r record;
begin
  for r in select id from public.payments where status::text = 'captured' order by created_at loop
    perform public.issue_invoice(r.id);
  end loop;
end $$;
