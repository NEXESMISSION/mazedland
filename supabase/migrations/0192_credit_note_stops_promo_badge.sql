-- ============================================================================
-- 0192 · A credit note stops the placement and the badge too.
--
-- issue_credit_note (0187) cancelled the plan period and revoked the pack's
-- credits, and nothing else: a refunded « mise en avant » kept running for
-- its 30 days — and blocked the seller from buying another one, « une à la
-- fois » — and a refunded badge stayed on the seller's annonces for a year
-- (the QA tour, 2026-10-30). Same function, two more steps, same transaction.
--
-- The placement is cleared only when it is the one this payment bought (the
-- three share one expiry, so a later placement of another kind is not this
-- payment's) and it was bought, not curated by an admin (promo_manual). The
-- metadata is read as text and checked before any cast: junk in an old row
-- must never make a credit note fail.
--
-- Rollback: supabase/rollbacks/0192_credit_note_stops_promo_badge.down.sql.
-- ============================================================================

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

  -- What the payment bought stops: the plan period, the pack's credits …
  update public.shop_subscriptions set status = 'cancelled'
   where payment_id = v_inv.payment_id and status = 'active';
  update public.seller_credits set status = 'revoked'
   where payment_id = v_inv.payment_id and status = 'active';

  -- … the placement it bought, when it is the one running on the annonce.
  -- The promo route writes the column in metadata.placement; an older row
  -- says it through its product's slug.
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

  -- … and the badge it bought.
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
