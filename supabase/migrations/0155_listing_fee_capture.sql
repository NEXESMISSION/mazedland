-- ============================================================================
-- PIVOT PHASE 7 — a captured publication fee moves the annonce into the queue.
--
-- The seller pays by bank transfer or D17, uploads the receipt, an admin
-- captures it. At that moment the annonce must stop waiting for money and start
-- waiting for moderation. Nothing on Batta did that: `/api/admin/paiements` was
-- ported from Mazed Auto, whose comments say "the `_listing_fee_captured`
-- trigger does the cascade" — and the trigger was never ported with it.
--
-- Which means, until now, validating a receipt marked the payment captured and
-- left the annonce sitting in `pending_payment` forever. Nobody had hit it yet
-- because Batta has no fee payments at all; it would have failed on the first
-- one. Found by listing the triggers on `payments` after the auction drop and
-- noticing the route's cascade had nothing to cascade through.
--
-- Doing it in the database rather than in the admin route means it holds for
-- EVERY capture path — the payments queue, a manual fix, a future automated
-- gateway — instead of only the one screen we remember to wire.
--
-- Payment -> `pending_review`, never straight to `published`: paying buys a
-- publication, not the right to skip the check. Moderation is what a paid
-- annonce is worth more than a free one on a classifieds board, and on property
-- it is the whole reason a buyer trusts the catalogue.
--
-- This is a standalone trigger, not a branch inside `_on_payment_captured` as
-- on Auto: 0153 deleted that function outright, because everything else it did
-- was auction bookkeeping.
-- ============================================================================

create or replace function public._listing_fee_captured()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid;
  v_title      text;
  v_seller     uuid;
begin
  -- Only on the transition INTO captured, and only for v3 listing fees (the
  -- ones that carry a listing_id in metadata; old property fees do not).
  if new.status <> 'captured'
     or (tg_op = 'UPDATE' and old.status = 'captured')
     or new.kind <> 'listing_fee' then
    return new;
  end if;

  begin
    v_listing_id := (new.metadata ->> 'listing_id')::uuid;
  exception when others then
    return new;   -- not a v3 fee, or malformed metadata: nothing to do
  end;
  if v_listing_id is null then
    return new;
  end if;

  update public.listings
     set status = 'pending_review',
         rejection_reason = null
   where id = v_listing_id
     and status in ('pending_payment', 'draft', 'rejected')
  returning title, seller_id into v_title, v_seller;

  if v_seller is not null then
    -- Best-effort: a notification failure must never roll back a capture.
    begin
      perform public.enqueue_notification(
        v_seller,
        'listing_payment_received',
        'Paiement validé',
        format('« %s » passe à la vérification. Vous serez prévenu dès sa mise en ligne.', v_title),
        '/account/listings'
      );
    exception when others then
      raise warning 'listing fee capture notification failed for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists _listing_fee_captured on public.payments;
create trigger _listing_fee_captured
  after insert or update of status on public.payments
  for each row execute function public._listing_fee_captured();

notify pgrst, 'reload schema';
