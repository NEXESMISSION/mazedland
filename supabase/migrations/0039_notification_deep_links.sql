-- ============================================================================
-- Batta.tn — Deep-link the admin review notifications.
--
-- The "Annonce à valider" and "Nouveau reçu à vérifier" (listing-fee) pings
-- previously dropped the admin on the broad /admin/properties queue. The
-- property id is in scope at the trigger, and there's now a unified review
-- page at /admin/properties/<id> (photos + characteristics + documents +
-- receipt in one place), so we point straight at it.
--
-- Also repairs the buyer receipt acknowledgment link: /account/payments
-- never existed → /account.
--
-- Only the two small notification trigger functions are recreated; the
-- auction-engine functions (already deep-linked to /auctions/<id>) are
-- untouched. CREATE OR REPLACE keeps the existing triggers bound.
-- ============================================================================

-- ─── Payment → pending_review: buyer ack + admin ping ──────────────────────
create or replace function public._on_payment_pending_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_what text;
  v_admin_link text;
begin
  if new.status = 'pending_review'
     and (old.status is null or old.status is distinct from 'pending_review') then

    -- 1) Buyer acknowledgment. (/account/payments doesn't exist → /account)
    perform public.enqueue_notification(
      new.user_id,
      'payment_receipt_received',
      'Reçu reçu',
      'Votre reçu de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a bien été reçu. Notre équipe le vérifiera sous 24-48h.',
      '/account'
    );

    -- 2) Admin queue ping. Listing-fee receipts deep-link to the unified
    --    property review page (/admin/properties/<id>); everything else
    --    lands on the payments queue.
    if new.kind = 'listing_fee' then
      v_what := 'frais d''annonce';
      v_admin_link := coalesce(
        '/admin/properties/' || new.property_id::text,
        '/admin/payments'
      );
    else
      v_what := 'paiement';
      v_admin_link := '/admin/payments';
    end if;

    perform public._notify_admins(
      'admin_receipt_pending',
      'Nouveau reçu à vérifier',
      'Un reçu de ' || v_what || ' (' ||
        to_char(new.amount, 'FM999G999G990D00') || ' TND) attend votre validation.',
      v_admin_link
    );
  end if;
  return new;
end;
$$;

-- ─── Property → pending_review: admin ping ─────────────────────────────────
create or replace function public._on_property_pending_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_review'
     and (old.status is null or old.status is distinct from 'pending_review') then
    perform public._notify_admins(
      'admin_listing_pending',
      'Annonce à valider',
      'Une annonce'
        || coalesce(' « ' || new.title || ' »', '')
        || ' attend votre validation.',
      '/admin/properties/' || new.id::text
    );
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
