-- ============================================================================
-- Batta.tn — Phase 1: in-app notifications for the auction lifecycle.
--
-- Existing 0024 already shipped: notifications table, RLS, realtime, RPC.
-- Existing wiring: KYC verdicts, payment receipt verdicts, listing-fee
-- accept/reject.
--
-- This migration retrofits the two core auction RPCs (place_bid,
-- tick_auctions) to enqueue notifications for every state change a
-- participant would want to know about:
--
--   place_bid()
--     - 'bid_placed'         → bidder (own confirmation)
--     - 'outbid'             → previous high bidder (English only)
--     - 'watched_new_bid'    → every watchlist follower (excluding bidder)
--     - 'auction_won'        → winner (Dutch auctions only — they hammer
--                              immediately on first accept)
--     - 'dutch_accepted'     → seller (Dutch only)
--
--   tick_auctions()
--     - 'auction_won'              → winner when auction ends sold
--     - 'auction_sold_seller'      → seller when auction ends sold
--     - 'reserve_not_met'          → seller when ended_unsold w/ bids
--     - 'auction_ended_unsold'     → seller when ended_unsold w/o bids
--     - 'sixth_offer_awarded'      → final winner when window closes
--     - 'sixth_offer_outbid'       → original winner if a sixth-offer wins
--     - 'auction_finalized_seller' → seller when sixth-offer window closes
--
-- All notification calls are wrapped with safe property-title lookups
-- so the body text always reads naturally even when the property has
-- since been edited or deleted (defensive — should not happen).
-- ============================================================================

-- ─── place_bid: bid_placed + outbid + watched_new_bid + dutch shortcuts ────

create or replace function public.place_bid(
  p_auction_id uuid,
  p_amount     numeric,
  p_max_amount numeric default null,
  p_ip         inet    default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid := auth.uid();
  v_auction     public.auctions%rowtype;
  v_min_next    numeric;
  v_dutch       numeric;
  v_bid_id      uuid;
  v_now         timestamptz := now();
  v_kyc         kyc_status;
  v_extend      boolean := false;
  v_prev_high   uuid;
  v_prev_amount numeric;
  v_prop_title  text;
  v_seller_id   uuid;
  v_link        text;
begin
  if v_user is null then raise exception 'auth'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'auction_not_found'; end if;
  if v_auction.status not in ('live', 'extending') then raise exception 'auction_closed'; end if;
  if v_auction.ends_at <= v_now then raise exception 'auction_expired'; end if;

  select kyc_status into v_kyc from public.profiles where id = v_user;
  if v_kyc is distinct from 'verified' then raise exception 'kyc_required'; end if;

  if not exists (
    select 1 from public.auction_deposits
     where auction_id = p_auction_id and user_id = v_user
       and released_at is null and forfeited_at is null
  ) then raise exception 'deposit_required'; end if;

  if exists (
    select 1 from public.properties p
     where p.id = v_auction.property_id and p.owner_id = v_user
  ) then raise exception 'self_bid_forbidden'; end if;

  if v_auction.type = 'english' then
    if v_auction.current_price is null then
      if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
    else
      v_min_next := v_auction.current_price + public.bid_increment(v_auction.current_price);
      if p_amount < v_min_next then raise exception 'below_min_increment'; end if;
    end if;

    -- Capture previous high bidder BEFORE inserting our bid so the
    -- outbid notification doesn't fire on the bidder themselves.
    select bidder_id, amount into v_prev_high, v_prev_amount
      from public.bids
     where auction_id = p_auction_id
     order by amount desc, placed_at asc
     limit 1;

  elsif v_auction.type = 'dutch' then
    v_dutch := public.dutch_current_price(v_auction);
    if abs(p_amount - v_dutch) > 0.5 then raise exception 'dutch_price_drifted'; end if;
  elsif v_auction.type = 'sealed' then
    if p_amount < v_auction.opening_price then raise exception 'below_opening'; end if;
  end if;

  insert into public.bids (auction_id, bidder_id, amount, max_amount, is_proxy, ip_address)
  values (
    p_auction_id, v_user, p_amount, p_max_amount,
    p_max_amount is not null and p_max_amount > p_amount,
    p_ip
  )
  returning id into v_bid_id;

  v_extend := (v_auction.ends_at - v_now)
            <= make_interval(secs => v_auction.extend_window_seconds);

  if v_auction.type = 'english' then
    update public.auctions
       set current_price = p_amount,
           ends_at = case when v_extend
             then ends_at + make_interval(secs => extend_by_seconds)
             else ends_at end,
           status = case when v_extend
             then 'extending'::auction_status
             else status end
     where id = p_auction_id;
  elsif v_auction.type = 'sealed' then
    update public.auctions
       set ends_at = case when v_extend
             then ends_at + make_interval(secs => extend_by_seconds)
             else ends_at end,
           status = case when v_extend
             then 'extending'::auction_status
             else status end
     where id = p_auction_id;
  elsif v_auction.type = 'dutch' then
    update public.auctions
       set current_price  = p_amount,
           status         = 'ended_sold',
           winner_user_id = v_user,
           winner_amount  = p_amount,
           hammer_at      = v_now
     where id = p_auction_id;
  end if;

  -- ─── Notifications ─────────────────────────────────────────────────────
  -- Read property title + seller for body copy. Best-effort; if these
  -- fail (deleted property), fallback strings render fine.
  select p.title, p.owner_id into v_prop_title, v_seller_id
    from public.properties p where p.id = v_auction.property_id;
  v_link := '/auctions/' || p_auction_id::text;

  -- 1) Confirmation to the bidder (English/sealed only — Dutch users get
  --    the won notification instead, see below).
  if v_auction.type in ('english', 'sealed') then
    perform public.enqueue_notification(
      v_user,
      'bid_placed',
      'Enchère placée',
      'Votre offre de ' || to_char(p_amount, 'FM999G999G990D00') || ' TND sur ' ||
        coalesce('« ' || v_prop_title || ' »', 'votre enchère') || ' a été enregistrée.',
      v_link
    );
  end if;

  -- 2) Outbid notification for the previous high bidder (English only —
  --    sealed bids stay blind so we cannot reveal who beat whom).
  if v_auction.type = 'english'
     and v_prev_high is not null
     and v_prev_high <> v_user then
    perform public.enqueue_notification(
      v_prev_high,
      'outbid',
      'Vous avez été surenchéri',
      'Une nouvelle offre de ' || to_char(p_amount, 'FM999G999G990D00') || ' TND a été placée sur ' ||
        coalesce('« ' || v_prop_title || ' »', 'cette enchère') || '. Réagissez avant la fin.',
      v_link
    );
  end if;

  -- 3) Watchlist alerts for everyone following this auction (except the
  --    bidder themselves and the seller). Use enqueue_notification per
  --    user so RLS + insert audit remain consistent.
  perform public.enqueue_notification(
    w.user_id,
    'watched_new_bid',
    'Nouvelle offre sur un bien suivi',
    coalesce('« ' || v_prop_title || ' »', 'Une enchère suivie') || ' vient de recevoir une nouvelle offre.',
    v_link
  )
  from public.watchlist w
  where w.auction_id = p_auction_id
    and w.user_id <> v_user
    and (v_seller_id is null or w.user_id <> v_seller_id);

  -- 4) Dutch shortcut — hammer fell, so the bidder won and the seller sold.
  if v_auction.type = 'dutch' then
    perform public.enqueue_notification(
      v_user,
      'auction_won',
      'Vous avez gagné !',
      'Votre acceptation à ' || to_char(p_amount, 'FM999G999G990D00') || ' TND a clôturé ' ||
        coalesce('« ' || v_prop_title || ' »', 'l''enchère') || '. Procédez au paiement final.',
      v_link
    );
    if v_seller_id is not null and v_seller_id <> v_user then
      perform public.enqueue_notification(
        v_seller_id,
        'auction_sold_seller',
        'Votre bien a été vendu',
        coalesce('« ' || v_prop_title || ' »', 'Votre annonce') || ' a été vendu à ' ||
          to_char(p_amount, 'FM999G999G990D00') || ' TND.',
        v_link
      );
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'current_price', case when v_auction.type = 'sealed' then null else p_amount end,
    'extended', v_extend
  );
end;
$$;

-- ─── tick_auctions: notifications on every state transition ────────────────

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
  v_a         public.auctions%rowtype;
  v_top_bid   record;
  v_top_sixth record;
  v_title     text;
  v_seller    uuid;
  v_link      text;
begin
  -- 1) START — no notifications (silent transition; bidders see the live
  --    badge in the UI, watchers don't expect a ping for "auction started").
  with started as (
    update public.auctions
       set status = 'live'
     where status = 'scheduled'
       and starts_at <= v_now
       and ends_at   >  v_now
     returning 1
  )
  select count(*) into v_started from started;

  -- 2) CLOSE
  for v_a in
    select * from public.auctions
     where status in ('live', 'extending')
       and ends_at <= v_now
     for update skip locked
  loop
    select p.title, p.owner_id into v_title, v_seller
      from public.properties p where p.id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    if v_a.type = 'dutch' then
      update public.auctions
         set status = 'ended_unsold'
       where id = v_a.id;
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
      -- Sale clears reserve (or there is none): open the 8-day sixth-offer window.
      update public.auctions
         set status               = 'sixth_offer_window',
             current_price        = v_top_bid.amount,
             winner_user_id       = v_top_bid.bidder_id,
             winner_amount        = v_top_bid.amount,
             hammer_at            = v_now,
             sixth_offer_deadline = v_now + interval '8 days'
       where id = v_a.id;

      -- Notify the provisional winner — the sixth-offer window is part
      -- of Tunisian auction practice, so the message acknowledges they
      -- "lead" but are not yet final.
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

  -- 3) SIXTH-OFFER FINALIZE
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
      update public.auctions set status = 'awarded' where id = v_a.id;

      -- Final winner — same person who already got the 'auction_won' ping
      -- but this confirms the sixth-offer window closed clean.
      if v_a.winner_user_id is not null then
        perform public.enqueue_notification(
          v_a.winner_user_id,
          'sixth_offer_awarded',
          'Adjudication définitive',
          'La fenêtre d''offre du sixième sur ' ||
            coalesce('« ' || v_title || ' »', 'cette enchère') ||
            ' s''est terminée. Vous êtes adjudicataire final à ' ||
            to_char(v_a.winner_amount, 'FM999G999G990D00') || ' TND.',
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
      -- A higher sixth-offer landed: promote the new bidder, kick the prior winner.
      update public.auctions
         set status         = 'awarded',
             winner_user_id = v_top_sixth.bidder_id,
             winner_amount  = v_top_sixth.amount,
             current_price  = v_top_sixth.amount
       where id = v_a.id;

      perform public.enqueue_notification(
        v_top_sixth.bidder_id,
        'sixth_offer_awarded',
        'Offre du sixième acceptée',
        'Votre offre du sixième de ' || to_char(v_top_sixth.amount, 'FM999G999G990D00') ||
          ' TND remporte ' || coalesce('« ' || v_title || ' »', 'l''enchère') || '.',
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
    'started', v_started,
    'closed',  v_closed,
    'awarded', v_awarded,
    'at',      v_now
  );
end;
$$;

revoke all on function public.tick_auctions() from public;
grant execute on function public.tick_auctions() to service_role;

notify pgrst, 'reload schema';
