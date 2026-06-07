-- ============================================================================
-- AUCTION ENGINE (High) — restore the auction-close notifications that 0052
-- silently dropped.
--
-- 0032 made tick_auctions notify on every transition (auction_live[_seller],
-- auction_ended_unsold, reserve_not_met, auction_won, auction_sold_seller,
-- sixth_offer_awarded, sixth_offer_outbid, auction_finalized_seller) and stamp
-- final_payment_due_at on award. 0052 then rebuilt the function to add
-- auto-relist and, in doing so, DROPPED every enqueue_notification call — so on
-- the normal (tick) close of an English/sealed auction the winner is never told
-- they won, the seller is never told it sold, and none of those rows ever reach
-- the email outbox. 0060 patched only final_payment_due_at (via trigger), not
-- the notifications.
--
-- This migration is the faithful MERGE: 0032's fully-notifying function with
-- 0052's relist INSERT spliced into each ended_unsold branch. No new behavior
-- beyond restoring what 0052 regressed; final_payment_due_at is set explicitly
-- here too (the 0060 trigger remains a harmless backstop).
--
-- NOTE (tracked separately): releasing LOSING bidders' deposits on close is a
-- distinct enhancement that interacts with the 8-day sixth-offer window and the
-- admin "prepare refunds" flow (which currently performs the release), so it is
-- handled in its own migration rather than bundled here.
-- ============================================================================

create or replace function public.tick_auctions()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_started   int := 0;
  v_closed    int := 0;
  v_awarded   int := 0;
  v_relisted  int := 0;
  v_a         public.auctions%rowtype;
  v_top_bid   record;
  v_top_sixth record;
  v_title     text;
  v_seller    uuid;
  v_link      text;
  v_payment_deadline interval := interval '14 days';
  -- Relist scratch (from 0052).
  v_duration      interval;
  v_delay_seconds int;
  v_new_starts    timestamptz;
  v_new_ends      timestamptz;
begin
  -- 1) START — notify seller and every watcher.
  for v_a in
    select * from public.auctions
     where status = 'scheduled'
       and starts_at <= v_now
       and ends_at   >  v_now
     for update skip locked
  loop
    update public.auctions set status = 'live' where id = v_a.id;
    select p.title, p.owner_id into v_title, v_seller
      from public.properties p where p.id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    if v_seller is not null then
      perform public.enqueue_notification(
        v_seller,
        'auction_live_seller',
        'Votre enchère est en direct',
        coalesce('« ' || v_title || ' »', 'Votre annonce') ||
          ' est désormais ouverte aux enchères.',
        v_link
      );
    end if;

    perform public.enqueue_notification(
      w.user_id,
      'auction_live',
      'Enchère en direct',
      coalesce('« ' || v_title || ' »', 'Une enchère suivie') ||
        ' est maintenant ouverte aux enchères.',
      v_link
    )
    from public.watchlist w
    where w.auction_id = v_a.id
      and (v_seller is null or w.user_id <> v_seller);

    v_started := v_started + 1;
  end loop;

  -- 2) CLOSE — set terminal state, relist unsold (0052), notify (0032).
  for v_a in
    select * from public.auctions
     where status in ('live', 'extending')
       and ends_at <= v_now
     for update skip locked
  loop
    select p.title, p.owner_id into v_title, v_seller
      from public.properties p where p.id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    -- Dutch timeout — no buyer accepted.
    if v_a.type = 'dutch' then
      update public.auctions set status = 'ended_unsold' where id = v_a.id;

      if v_a.listing_type = 'auction' then
        v_duration      := v_a.ends_at - v_a.starts_at;
        v_delay_seconds := 3600 + floor(random() * (172800 - 3600 + 1))::int;
        v_new_starts    := v_now + make_interval(secs => v_delay_seconds);
        v_new_ends      := v_new_starts + v_duration;
        insert into public.auctions (
          property_id, type, opening_price, reserve_price,
          dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
          starts_at, ends_at, extend_window_seconds, extend_by_seconds, status,
          listing_type, sale_price, sale_negotiable, buy_now_price, relisted_from_id
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends, v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price, v_a.id
        );
        v_relisted := v_relisted + 1;
      end if;

      if v_seller is not null then
        perform public.enqueue_notification(
          v_seller,
          'auction_ended_unsold',
          'Enchère terminée sans vente',
          coalesce('« ' || v_title || ' »', 'Votre annonce') || ' s''est terminée sans acquéreur.',
          v_link
        );
      end if;
      v_closed := v_closed + 1;
      continue;
    end if;

    -- English + sealed: find the high bid.
    select bidder_id, amount
      into v_top_bid
      from public.bids
     where auction_id = v_a.id
     order by amount desc, placed_at asc
     limit 1;

    if v_top_bid is null then
      update public.auctions set status = 'ended_unsold' where id = v_a.id;

      if v_a.listing_type = 'auction' then
        v_duration      := v_a.ends_at - v_a.starts_at;
        v_delay_seconds := 3600 + floor(random() * (172800 - 3600 + 1))::int;
        v_new_starts    := v_now + make_interval(secs => v_delay_seconds);
        v_new_ends      := v_new_starts + v_duration;
        insert into public.auctions (
          property_id, type, opening_price, reserve_price,
          dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
          starts_at, ends_at, extend_window_seconds, extend_by_seconds, status,
          listing_type, sale_price, sale_negotiable, buy_now_price, relisted_from_id
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends, v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price, v_a.id
        );
        v_relisted := v_relisted + 1;
      end if;

      if v_seller is not null then
        perform public.enqueue_notification(
          v_seller,
          'auction_ended_unsold',
          'Enchère terminée sans offre',
          coalesce('« ' || v_title || ' »', 'Votre annonce') || ' s''est terminée sans aucune offre.',
          v_link
        );
      end if;

    elsif v_a.reserve_price is not null and v_top_bid.amount < v_a.reserve_price then
      update public.auctions set status = 'ended_unsold' where id = v_a.id;

      if v_a.listing_type = 'auction' then
        v_duration      := v_a.ends_at - v_a.starts_at;
        v_delay_seconds := 3600 + floor(random() * (172800 - 3600 + 1))::int;
        v_new_starts    := v_now + make_interval(secs => v_delay_seconds);
        v_new_ends      := v_new_starts + v_duration;
        insert into public.auctions (
          property_id, type, opening_price, reserve_price,
          dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
          starts_at, ends_at, extend_window_seconds, extend_by_seconds, status,
          listing_type, sale_price, sale_negotiable, buy_now_price, relisted_from_id
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends, v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price, v_a.id
        );
        v_relisted := v_relisted + 1;
      end if;

      if v_seller is not null then
        perform public.enqueue_notification(
          v_seller,
          'reserve_not_met',
          'Prix de réserve non atteint',
          'L''offre la plus haute sur ' || coalesce('« ' || v_title || ' »', 'votre annonce') ||
            ' (' || to_char(v_top_bid.amount, 'FM999G999G990D00') ||
            ' TND) n''a pas atteint votre prix de réserve.',
          v_link
        );
      end if;

    else
      -- Valid winner at/above reserve → open the 8-day sixth-offer window.
      update public.auctions
         set status               = 'sixth_offer_window',
             current_price        = v_top_bid.amount,
             winner_user_id       = v_top_bid.bidder_id,
             winner_amount        = v_top_bid.amount,
             hammer_at            = v_now,
             sixth_offer_deadline = v_now + interval '8 days'
       where id = v_a.id;

      perform public.enqueue_notification(
        v_top_bid.bidder_id,
        'auction_won',
        'Vous êtes adjudicataire',
        'Votre offre de ' || to_char(v_top_bid.amount, 'FM999G999G990D00') || ' TND remporte ' ||
          coalesce('« ' || v_title || ' »', 'l''enchère') ||
          '. La fenêtre d''offre du sixième est ouverte 8 jours.',
        v_link
      );
      if v_seller is not null and v_seller <> v_top_bid.bidder_id then
        perform public.enqueue_notification(
          v_seller,
          'auction_sold_seller',
          'Adjudication confirmée',
          coalesce('« ' || v_title || ' »', 'Votre annonce') || ' a été adjugé à ' ||
            to_char(v_top_bid.amount, 'FM999G999G990D00') ||
            ' TND. Fenêtre d''offre du sixième : 8 jours.',
          v_link
        );
      end if;
    end if;
    v_closed := v_closed + 1;
  end loop;

  -- 3) SIXTH-OFFER FINALIZE — award + stamp final_payment_due_at + notify.
  for v_a in
    select * from public.auctions
     where status = 'sixth_offer_window'
       and sixth_offer_deadline is not null
       and sixth_offer_deadline <= v_now
     for update skip locked
  loop
    select p.title, p.owner_id into v_title, v_seller
      from public.properties p where p.id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    select bidder_id, amount
      into v_top_sixth
      from public.sixth_offers
     where auction_id = v_a.id
     order by amount desc, placed_at asc
     limit 1;

    if v_top_sixth is null then
      update public.auctions
         set status = 'awarded',
             final_payment_due_at = v_now + v_payment_deadline
       where id = v_a.id;

      if v_a.winner_user_id is not null then
        perform public.enqueue_notification(
          v_a.winner_user_id,
          'sixth_offer_awarded',
          'Adjudication définitive',
          'La fenêtre d''offre du sixième sur ' ||
            coalesce('« ' || v_title || ' »', 'cette enchère') ||
            ' s''est terminée. Vous êtes adjudicataire final à ' ||
            to_char(v_a.winner_amount, 'FM999G999G990D00') || ' TND. ' ||
            'Paiement final à régler avant le ' ||
            to_char((v_now + v_payment_deadline) at time zone 'UTC', 'DD/MM/YYYY') || '.',
          v_link
        );
      end if;
      if v_seller is not null
         and (v_a.winner_user_id is null or v_seller <> v_a.winner_user_id) then
        perform public.enqueue_notification(
          v_seller,
          'auction_finalized_seller',
          'Vente finalisée',
          coalesce('« ' || v_title || ' »', 'Votre annonce') ||
            ' est définitivement adjugé. Suivi du paiement final dans votre tableau de bord.',
          v_link
        );
      end if;
    else
      update public.auctions
         set status         = 'awarded',
             winner_user_id = v_top_sixth.bidder_id,
             winner_amount  = v_top_sixth.amount,
             current_price  = v_top_sixth.amount,
             final_payment_due_at = v_now + v_payment_deadline
       where id = v_a.id;

      perform public.enqueue_notification(
        v_top_sixth.bidder_id,
        'sixth_offer_awarded',
        'Offre du sixième acceptée',
        'Votre offre du sixième de ' || to_char(v_top_sixth.amount, 'FM999G999G990D00') ||
          ' TND remporte ' || coalesce('« ' || v_title || ' »', 'l''enchère') ||
          '. Paiement final à régler avant le ' ||
          to_char((v_now + v_payment_deadline) at time zone 'UTC', 'DD/MM/YYYY') || '.',
        v_link
      );

      if v_a.winner_user_id is not null and v_a.winner_user_id <> v_top_sixth.bidder_id then
        perform public.enqueue_notification(
          v_a.winner_user_id,
          'sixth_offer_outbid',
          'Vous avez été surenchéri (offre du sixième)',
          'Une offre du sixième supérieure (' ||
            to_char(v_top_sixth.amount, 'FM999G999G990D00') ||
            ' TND) a clôturé ' || coalesce('« ' || v_title || ' »', 'cette enchère') || '.',
          v_link
        );
      end if;

      if v_seller is not null and v_seller <> v_top_sixth.bidder_id then
        perform public.enqueue_notification(
          v_seller,
          'auction_finalized_seller',
          'Vente finalisée (offre du sixième)',
          coalesce('« ' || v_title || ' »', 'Votre annonce') ||
            ' a été adjugé à ' || to_char(v_top_sixth.amount, 'FM999G999G990D00') ||
            ' TND via l''offre du sixième.',
          v_link
        );
      end if;
    end if;
    v_awarded := v_awarded + 1;
  end loop;

  return json_build_object(
    'started',  v_started,
    'closed',   v_closed,
    'awarded',  v_awarded,
    'relisted', v_relisted,
    'at',       v_now
  );
end;
$$;

revoke all on function public.tick_auctions() from public;
grant execute on function public.tick_auctions() to service_role;

notify pgrst, 'reload schema';
