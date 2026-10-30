-- ============================================================================
-- 0193 · A credit note on an upgrade gives back what the upgrade took.
--
-- A new plan period replaces the smaller periods still ahead of its start —
-- an upgrade ends the running one at once, a renewal cancels a smaller plan
-- queued behind it — and their unused time comes off its price
-- (src/lib/pro/planChange.ts). issue_credit_note (0187) cancelled only the
-- period the refunded payment had granted: on 2026-10-30 (the QA tour) a
-- credit note on a Starter → Pro upgrade left the agence with no plan at
-- all, the Starter month it had paid cut short for nothing.
--
-- Each replaced period now remembers which payment replaced it and the end
-- it had (written by grantPlanPeriod, src/lib/pro/shops.ts), and the credit
-- note on that payment puts them back: running again to the end they had —
-- unless their own payment was refunded meanwhile.
--
-- Periods replaced before this migration carry no mark: a credit note on an
-- older upgrade still cancels that upgrade's period only, as before.
--
-- Builds on 0192 (same function): the placement and the badge the refunded
-- payment bought stop too. Both migrations ship together; this one is the
-- last word on issue_credit_note.
--
-- Rollback: supabase/rollbacks/0193_credit_note_restores_periods.down.sql.
-- ============================================================================

alter table public.shop_subscriptions
  add column if not exists replaced_by uuid references public.payments(id) on delete set null,
  add column if not exists ends_at_before timestamptz;

comment on column public.shop_subscriptions.replaced_by is
  'The payment whose period ended or cancelled this one (an upgrade, a renewal over a smaller plan queued behind); a credit note on it restores this period.';
comment on column public.shop_subscriptions.ends_at_before is
  'The end this period had before replaced_by cut it short; null when it was cancelled whole.';

create index if not exists shop_subscriptions_replaced_by_idx
  on public.shop_subscriptions (replaced_by)
  where replaced_by is not null;

create or replace function public.issue_credit_note(p_invoice_id uuid, p_reason text, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv       public.invoices;
  v_id        uuid;
  v_year      text;
  v_placement text;
  v_listing   text;
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

  -- What that payment's period had replaced runs again, to the end it had,
  -- when its own payment still stands (or an admin gave it).
  update public.shop_subscriptions s
     set status = 'active',
         ends_at = coalesce(s.ends_at_before, s.ends_at),
         ends_at_before = null,
         replaced_by = null
   where s.replaced_by = v_inv.payment_id
     and (s.payment_id is null
          or exists (select 1 from public.payments p where p.id = s.payment_id and p.status::text = 'captured'));

  update public.seller_credits set status = 'revoked'
   where payment_id = v_inv.payment_id and status = 'active';

  -- … the placement it bought (0192), when it is the one running on the
  -- annonce. The promo route writes the column in metadata.placement; an
  -- older row says it through its product's slug.
  select coalesce(p.metadata->>'placement',
                  case pr.slug
                    when 'promo-accueil'       then 'promo_home_featured'
                    when 'promo-top-recherche' then 'promo_top_listed'
                    when 'promo-banniere'      then 'promo_banner'
                  end),
         p.metadata->>'listing_id'
    into v_placement, v_listing
    from public.payments p
    left join public.products pr on pr.id::text = p.metadata->>'product_id'
   where p.id = v_inv.payment_id
     and p.kind::text = 'promo';

  if v_placement is not null
     and v_listing ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.listings
       set promo_home_featured = false,
           promo_top_listed    = false,
           promo_banner        = false,
           promo_expires_at    = null
     where id = v_listing::uuid
       and coalesce(promo_manual, false) = false
       and ((v_placement = 'promo_home_featured' and promo_home_featured)
         or (v_placement = 'promo_top_listed'    and promo_top_listed)
         or (v_placement = 'promo_banner'        and promo_banner));
  end if;

  -- … and the badge it bought (0192).
  update public.seller_badges
     set revoked_at = now(),
         revoke_reason = left('Avoir : ' || trim(p_reason), 300)
   where payment_id = v_inv.payment_id
     and revoked_at is null;

  insert into public.admin_audit (actor_id, action, target_type, target_id, note, after)
  values (p_actor, 'invoice.credit_note', 'invoice', v_inv.id::text, trim(p_reason),
          jsonb_build_object('credit_note_id', v_id, 'invoice', v_inv.number));

  return v_id;
end;
$$;

revoke execute on function public.issue_credit_note(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_credit_note(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
