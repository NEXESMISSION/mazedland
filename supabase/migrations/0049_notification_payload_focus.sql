-- ============================================================================
-- Batta.tn — Plumb payload through enqueue_notification + bake focus ids
--            into payment-receipt acks.
--
-- The notifications.payload jsonb column (added in 0035) was only writable
-- through the broadcast RPC. Per-user notifications created by triggers
-- went via enqueue_notification, which had no payload arg, so all the
-- focused-deep-link metadata we'd want — "this notification is about
-- payment <id>" — had nowhere to live.
--
-- This migration:
--   1. Adds a 6-arg `enqueue_notification` overload that accepts
--      p_payload jsonb. PostgREST dispatches by argument *name*, so callers
--      that pass p_payload select the new form automatically; the old
--      5-arg signature is kept untouched so every existing trigger /
--      service-role caller continues to work.
--   2. Rebuilds `_on_payment_pending_review` to set payload.focus = the
--      newly-pending payment's id, so the buyer's ack — which lands on
--      /account/payments — can scroll-to-row and ring the right card via
--      the FocusRowHighlight client component.
--   3. Leaves admin pings, listing notifications, and auction notifications
--      alone — their links already deep-link to a specific row (admin
--      queues with id, /auctions/<id>, /sell/<id>) and don't need a
--      list-page focus hint.
-- ============================================================================

-- ─── 1. enqueue_notification 6-arg overload ───────────────────────────────
create or replace function public.enqueue_notification(
  p_user_id  uuid,
  p_kind     text,
  p_title    text,
  p_body     text,
  p_link     text,
  p_payload  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (user_id, kind, title, body, link, payload)
  values (p_user_id, p_kind, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb) to authenticated;

-- ─── 2. _on_payment_pending_review — set payload.focus to the payment id ─
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

    -- Buyer ack lands on /account/payments. payload.focus tells the list
    -- page which row to ring + scroll into view.
    perform public.enqueue_notification(
      new.user_id,
      'payment_receipt_received',
      'Reçu reçu',
      'Votre reçu de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a bien été reçu. Notre équipe le vérifiera sous 24-48h.',
      '/account/payments',
      jsonb_build_object('focus', new.id::text)
    );

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
