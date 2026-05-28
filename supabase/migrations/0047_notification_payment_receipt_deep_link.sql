-- ============================================================================
-- Batta.tn — Point payment_receipt_received at /account/payments.
--
-- When migration 0039 was written, /account/payments did not exist, so the
-- buyer acknowledgment of a freshly uploaded receipt dumped them on the
-- generic /account page. The payment list page now exists (it shows kind,
-- status badges, receipt previews, and the auction/property the payment
-- relates to), so we route there instead — the user can see "my receipt is
-- in review" directly.
--
-- Only _on_payment_pending_review is recreated; CREATE OR REPLACE keeps the
-- existing trigger binding intact.
-- ============================================================================

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

    -- 1) Buyer acknowledgment → payments history (shows the receipt + status).
    perform public.enqueue_notification(
      new.user_id,
      'payment_receipt_received',
      'Reçu reçu',
      'Votre reçu de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a bien été reçu. Notre équipe le vérifiera sous 24-48h.',
      '/account/payments'
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

notify pgrst, 'reload schema';
