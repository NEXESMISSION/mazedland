-- ============================================================================
-- AUCTION CONFIG — winner's final-payment deadline is now ADMIN-TUNABLE.
--
-- The "14 days to pay the balance" window was hard-coded in tick_auctions and
-- in the _stamp_final_payment_due trigger. This migration introduces ONE source
-- of truth — final_payment_interval() — that reads app_settings 'final_payment_days'
-- ({"days": N}, clamped 1..90, default 14). Both the cron state machine and the
-- safety-net stamp trigger call it, so changing the admin setting governs every
-- newly-awarded auction immediately. The reminder cron (T-7/T-1/overdue) keys off
-- the stamped final_payment_due_at column, so it adapts automatically.
--
-- tick_auctions body is VERBATIM from 0130 except the single v_payment_deadline
-- line. Idempotent (create or replace / on conflict do nothing).
-- ============================================================================

-- Seed the default so the admin form shows 14 and the helper has an explicit row.
insert into public.app_settings (key, value)
values ('final_payment_days', '{"days": 14}'::jsonb)
on conflict (key) do nothing;

-- Single source of truth for the winner's payment window. Reads the admin
-- setting; clamps to a sane 1..90 days; defaults to 14 when unset.
create or replace function public.final_payment_interval()
returns interval
language sql
stable
security definer
set search_path = public
as $func$
  select make_interval(days => greatest(1, least(90, coalesce(
    (select (value->>'days')::int from public.app_settings where key = 'final_payment_days'),
    14
  ))));
$func$;

-- Safety-net stamp (from 0060) now reads the same helper instead of a literal.
create or replace function public._stamp_final_payment_due()
returns trigger
language plpgsql
as $func$
begin
  if new.status = 'awarded'
     and old.status is distinct from 'awarded'
     and new.final_payment_due_at is null then
    new.final_payment_due_at := now() + public.final_payment_interval();
  end if;
  return new;
end;
$func$;

drop trigger if exists _stamp_final_payment_due on public.auctions;
create trigger _stamp_final_payment_due
  before update on public.auctions
  for each row execute function public._stamp_final_payment_due();

-- ── tick_auctions — final-payment deadline now from final_payment_interval() ──
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
  v_payment_deadline interval := public.final_payment_interval();
  v_duration      interval;
  v_delay_seconds int;
  v_new_starts    timestamptz;
  v_new_ends      timestamptz;
  v_batch     int := 500;
begin
  -- 1) START — notify seller, registered bidders (active caution), watchers.
  for v_a in
    select * from public.auctions
     where status = 'scheduled'
       and starts_at <= v_now
       and ends_at   >  v_now
     for update skip locked
     limit v_batch
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
      d.user_id,
      'auction_live',
      'Enchère ouverte — vous pouvez enchérir',
      coalesce('« ' || v_title || ' »', 'Une enchère') ||
        ' vient d''ouvrir. Votre caution est active — placez votre offre.',
      v_link || '/bid'
    )
    from (
      select distinct ad.user_id
        from public.auction_deposits ad
       where ad.auction_id   = v_a.id
         and ad.released_at  is null
         and ad.forfeited_at is null
    ) d
    where (v_seller is null or d.user_id <> v_seller);

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
      and (v_seller is null or w.user_id <> v_seller)
      and not exists (
        select 1
          from public.auction_deposits ad
         where ad.auction_id   = v_a.id
           and ad.user_id      = w.user_id
           and ad.released_at  is null
           and ad.forfeited_at is null
      );

    v_started := v_started + 1;
  end loop;

  -- 2) CLOSE — set terminal state, relist unsold (0052), notify (0032).
  for v_a in
    select * from public.auctions
     where status in ('live', 'extending')
       and ends_at <= v_now
     for update skip locked
     limit v_batch
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
          listing_type, sale_price, sale_negotiable, buy_now_price, relisted_from_id,
          sixth_offer_enabled
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends, v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price, v_a.id,
          v_a.sixth_offer_enabled
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
          listing_type, sale_price, sale_negotiable, buy_now_price, relisted_from_id,
          sixth_offer_enabled
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends, v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price, v_a.id,
          v_a.sixth_offer_enabled
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
          listing_type, sale_price, sale_negotiable, buy_now_price, relisted_from_id,
          sixth_offer_enabled
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends, v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price, v_a.id,
          v_a.sixth_offer_enabled
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
      -- Valid winner at/above reserve.
      if v_a.sixth_offer_enabled then
        -- Seller opted into the legal 1/6 overbid → open the 8-day window.
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
      else
        -- No sixth-offer window → award immediately with the 14-day deadline
        -- (identical end state to a window that closed with no overbids).
        update public.auctions
           set status               = 'awarded',
               current_price        = v_top_bid.amount,
               winner_user_id       = v_top_bid.bidder_id,
               winner_amount        = v_top_bid.amount,
               hammer_at            = v_now,
               final_payment_due_at = v_now + v_payment_deadline
         where id = v_a.id;

        perform public.enqueue_notification(
          v_top_bid.bidder_id,
          'auction_won',
          'Vous êtes adjudicataire',
          'Votre offre de ' || to_char(v_top_bid.amount, 'FM999G999G990D00') || ' TND remporte ' ||
            coalesce('« ' || v_title || ' »', 'l''enchère') ||
            '. Réglez le solde avant le ' ||
            to_char((v_now + v_payment_deadline) at time zone 'UTC', 'DD/MM/YYYY') || '.',
          v_link
        );
        if v_seller is not null and v_seller <> v_top_bid.bidder_id then
          perform public.enqueue_notification(
            v_seller,
            'auction_sold_seller',
            'Adjudication confirmée',
            coalesce('« ' || v_title || ' »', 'Votre annonce') || ' a été adjugé à ' ||
              to_char(v_top_bid.amount, 'FM999G999G990D00') || ' TND.',
            v_link
          );
        end if;
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
     limit v_batch
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
