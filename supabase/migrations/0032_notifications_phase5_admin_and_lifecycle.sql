-- ============================================================================
-- Batta.tn — Phase 5+: admin fan-out, seller real-time, lifecycle reminders.
--
-- Closes the second-order gaps identified in the deep notification audit:
--   * Admins were silent on every review queue (KYC, receipts, payouts,
--     listings, inspectors). They now receive a notification each time a
--     queue item lands.
--   * Sellers were not notified on individual bids, only at auction end.
--   * Scheduled → live transition was silent; watchers + sellers now get
--     pinged when an auction opens.
--   * Sixth-offer inserts did not notify the seller.
--   * Buyers did not get an acknowledgment when their receipt arrived
--     (only later on accept/reject).
--   * Awarded auctions had no final-payment deadline tracking, so no
--     reminders could fire. Adds final_payment_due_at + a scheduled job.
--   * Notifications table had no retention policy — added cleanup cron.
-- ============================================================================

-- ─── 1. _notify_admins helper — fan out a single notification to every admin
-- Used by all the admin-queue triggers below. SECURITY DEFINER so it
-- bypasses RLS on notifications.INSERT (which is service-role-only).
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public._notify_admins(
  p_kind  text,
  p_title text,
  p_body  text,
  p_link  text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, p_kind, p_title, p_body, p_link
    from public.profiles p
   where p.role = 'admin';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._notify_admins(text, text, text, text) from public;
grant execute on function public._notify_admins(text, text, text, text) to service_role;

-- ─── 2. KYC submission → notify admins ──────────────────────────────────────
-- Extends the existing _mirror_kyc_submission trigger so KYC submissions
-- also ping admins. We keep them as separate triggers so the mirror
-- behaviour stays isolated and easy to reason about.

create or replace function public._notify_admins_kyc_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select coalesce(full_name, 'Un utilisateur') into v_name
    from public.profiles where id = new.user_id;
  perform public._notify_admins(
    'admin_kyc_pending',
    'Nouvelle vérification d''identité',
    v_name || ' a soumis sa vérification d''identité.',
    '/admin/kyc-queue'
  );
  return new;
end;
$$;

drop trigger if exists on_kyc_submitted_admin on public.kyc_submissions;
create trigger on_kyc_submitted_admin
  after insert on public.kyc_submissions
  for each row execute function public._notify_admins_kyc_submitted();

-- ─── 3. Payment receipt uploaded → notify buyer + admins ────────────────────
-- Triggered when status flips from 'pending' → 'pending_review' (i.e. the
-- /api/payments/[id]/receipt route flips it after the buyer uploads).
-- Differentiates listing_fee receipts from regular payment receipts so
-- the admin gets a useful link.

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

    -- 1) Buyer acknowledgment.
    perform public.enqueue_notification(
      new.user_id,
      'payment_receipt_received',
      'Reçu reçu',
      'Votre reçu de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a bien été reçu. Notre équipe le vérifiera sous 24-48h.',
      '/account/payments'
    );

    -- 2) Admin queue ping. listing_fee receipts land on /admin/properties;
    --    everything else on /admin/payments.
    if new.kind = 'listing_fee' then
      v_what := 'frais d''annonce';
      v_admin_link := '/admin/properties';
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

drop trigger if exists on_payment_pending_review on public.payments;
create trigger on_payment_pending_review
  after update of status on public.payments
  for each row execute function public._on_payment_pending_review();

-- ─── 4. Property → pending_review → notify admins ──────────────────────────
-- The listing-fee RPC moves properties from draft → pending_review;
-- admins need to know to start the review.

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
      '/admin/properties'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_property_pending_review on public.properties;
create trigger on_property_pending_review
  after update of status on public.properties
  for each row execute function public._on_property_pending_review();

-- ─── 5. Inspector application → notify admins + ack inspector ──────────────
-- New rows in public.inspectors are unapproved applicants. Notify the
-- admin pool to review, and acknowledge the inspector.

create or replace function public._on_inspector_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select coalesce(full_name, 'Un candidat') into v_name
    from public.profiles where id = new.id;

  -- Ack the applicant on first creation only (don't re-fire on updates).
  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.id,
      'inspector_application_received',
      'Candidature reçue',
      'Votre candidature d''inspecteur a été enregistrée. L''équipe la traitera sous 5 jours ouvrés.',
      '/inspector'
    );

    if new.approved is false then
      perform public._notify_admins(
        'admin_inspector_pending',
        'Candidature inspecteur',
        v_name || ' a soumis une candidature d''inspecteur (' || new.speciality || ').',
        '/admin/inspectors'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_inspector_application on public.inspectors;
create trigger on_inspector_application
  after insert on public.inspectors
  for each row execute function public._on_inspector_application();

-- ─── 6. Payout request → notify admins ──────────────────────────────────────
-- Wraps request_payout to fan out to admins right after the insert.

create or replace function public.request_payout(
  p_amount numeric,
  p_iban   text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_balance   json;
  v_available numeric;
  v_payout_id uuid;
  v_name      text;
begin
  if v_user is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  v_balance := public.seller_balance(v_user);
  v_available := (v_balance ->> 'available')::numeric;

  if v_available < p_amount then
    raise exception 'insufficient_balance'
      using errcode = 'P0001',
            detail  = format('available: %s, requested: %s', v_available, p_amount);
  end if;

  insert into public.seller_payouts (seller_id, amount, iban, status)
  values (v_user, p_amount, p_iban, 'requested')
  returning id into v_payout_id;

  select coalesce(full_name, 'Un vendeur') into v_name
    from public.profiles where id = v_user;

  perform public._notify_admins(
    'admin_payout_pending',
    'Demande de versement',
    v_name || ' demande un versement de ' ||
      to_char(p_amount, 'FM999G999G990D00') || ' TND.',
    '/admin/payouts'
  );

  return json_build_object('ok', true, 'payout_id', v_payout_id);
end;
$$;

grant execute on function public.request_payout(numeric, text) to authenticated;

-- ─── 7. Sixth-offer INSERT trigger → notify seller + current top bidder ────

create or replace function public._on_sixth_offer_placed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction record;
  v_title   text;
  v_seller  uuid;
  v_link    text;
  v_top     record;
begin
  select a.id, a.property_id, a.winner_user_id
    into v_auction
    from public.auctions a where a.id = new.auction_id;
  if v_auction.id is null then
    return new;
  end if;
  select p.title, p.owner_id into v_title, v_seller
    from public.properties p where p.id = v_auction.property_id;
  v_link := '/auctions/' || new.auction_id::text;

  -- Notify the seller of every sixth-offer that lands.
  if v_seller is not null and v_seller <> new.bidder_id then
    perform public.enqueue_notification(
      v_seller,
      'seller_sixth_offer_received',
      'Offre du sixième reçue',
      'Une offre du sixième de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a été placée sur ' ||
        coalesce('« ' || v_title || ' »', 'votre annonce') || '.',
      v_link
    );
  end if;

  -- Ack the sixth-offer bidder.
  perform public.enqueue_notification(
    new.bidder_id,
    'sixth_offer_placed',
    'Offre du sixième placée',
    'Votre offre du sixième de ' || to_char(new.amount, 'FM999G999G990D00') ||
      ' TND a été enregistrée. Vous serez prévenu(e) à la clôture de la fenêtre.',
    v_link
  );
  return new;
end;
$$;

drop trigger if exists on_sixth_offer_placed on public.sixth_offers;
create trigger on_sixth_offer_placed
  after insert on public.sixth_offers
  for each row execute function public._on_sixth_offer_placed();

-- ─── 8. Final payment deadline column + setter in tick_auctions ────────────

alter table public.auctions
  add column if not exists final_payment_due_at  timestamptz,
  add column if not exists final_payment_warn_7d_at timestamptz,
  add column if not exists final_payment_warn_1d_at timestamptz,
  add column if not exists final_payment_overdue_at timestamptz;

-- Redefine place_bid to ALSO notify the seller on every English-auction
-- bid (previous build only notified bidder + outbid + watchers). Keeps
-- all the existing notifications intact.

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

  select p.title, p.owner_id into v_prop_title, v_seller_id
    from public.properties p where p.id = v_auction.property_id;
  v_link := '/auctions/' || p_auction_id::text;

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

  -- Seller real-time bid alert (English only — sealed stays blind).
  if v_auction.type = 'english'
     and v_seller_id is not null
     and v_seller_id <> v_user then
    perform public.enqueue_notification(
      v_seller_id,
      'seller_received_bid',
      'Nouvelle offre sur votre bien',
      'Une offre de ' || to_char(p_amount, 'FM999G999G990D00') || ' TND vient d''être placée sur ' ||
        coalesce('« ' || v_prop_title || ' »', 'votre annonce') || '.',
      v_link
    );
  end if;

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

-- Redefine tick_auctions to:
--   * notify on scheduled → live (seller + watchers)
--   * stamp final_payment_due_at on awarded transitions (14 days from now)
--   * keep all the close/sixth-offer notifications from 0029

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
  v_payment_deadline interval := interval '14 days';
begin
  -- 1) START — now notifies seller and every watcher.
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
      update public.auctions set status = 'ended_unsold' where id = v_a.id;
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

  -- 3) SIXTH-OFFER FINALIZE — also stamps final_payment_due_at.
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
    'started', v_started,
    'closed',  v_closed,
    'awarded', v_awarded,
    'at',      v_now
  );
end;
$$;

revoke all on function public.tick_auctions() from public;
grant execute on function public.tick_auctions() to service_role;

-- ─── 9. notify_final_payment_due — scheduled reminders + overdue alert ─────

create or replace function public.notify_final_payment_due()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a     record;
  v_title text;
  v_link  text;
  v_now   timestamptz := now();
  v_7d    int := 0;
  v_1d    int := 0;
  v_late  int := 0;
begin
  -- T-7d reminder.
  for v_a in
    select id, property_id, winner_user_id, winner_amount, final_payment_due_at
      from public.auctions
     where status = 'awarded'
       and winner_user_id is not null
       and final_payment_due_at is not null
       and final_payment_warn_7d_at is null
       and final_payment_due_at >  v_now + interval '6 days 12 hours'
       and final_payment_due_at <= v_now + interval '7 days'
  loop
    select title into v_title from public.properties where id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;
    perform public.enqueue_notification(
      v_a.winner_user_id,
      'final_payment_due_soon',
      'Paiement final dans 7 jours',
      'Votre paiement final pour ' || coalesce('« ' || v_title || ' »', 'votre enchère') ||
        ' (' || to_char(v_a.winner_amount, 'FM999G999G990D00') ||
        ' TND) est dû dans 7 jours.',
      v_link
    );
    update public.auctions set final_payment_warn_7d_at = v_now where id = v_a.id;
    v_7d := v_7d + 1;
  end loop;

  -- T-1d reminder.
  for v_a in
    select id, property_id, winner_user_id, winner_amount, final_payment_due_at
      from public.auctions
     where status = 'awarded'
       and winner_user_id is not null
       and final_payment_due_at is not null
       and final_payment_warn_1d_at is null
       and final_payment_due_at >  v_now + interval '12 hours'
       and final_payment_due_at <= v_now + interval '1 day 1 hour'
  loop
    select title into v_title from public.properties where id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;
    perform public.enqueue_notification(
      v_a.winner_user_id,
      'final_payment_due_tomorrow',
      'Paiement final demain',
      'Dernier rappel : votre paiement final pour ' ||
        coalesce('« ' || v_title || ' »', 'votre enchère') ||
        ' est dû demain.',
      v_link
    );
    update public.auctions set final_payment_warn_1d_at = v_now where id = v_a.id;
    v_1d := v_1d + 1;
  end loop;

  -- Overdue — notify both winner AND seller AND admins.
  for v_a in
    select id, property_id, winner_user_id, winner_amount, final_payment_due_at
      from public.auctions
     where status = 'awarded'
       and winner_user_id is not null
       and final_payment_due_at is not null
       and final_payment_overdue_at is null
       and final_payment_due_at <= v_now
  loop
    select title into v_title from public.properties where id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    perform public.enqueue_notification(
      v_a.winner_user_id,
      'final_payment_overdue',
      'Paiement final en retard',
      'Votre paiement final pour ' || coalesce('« ' || v_title || ' »', 'votre enchère') ||
        ' est en retard. Contactez l''équipe Batta.tn pour éviter la perte de votre caution.',
      v_link
    );

    -- Notify the seller too.
    perform public.enqueue_notification(
      p.owner_id,
      'final_payment_overdue_seller',
      'Paiement acheteur en retard',
      'Le paiement final de l''acheteur pour ' ||
        coalesce('« ' || v_title || ' »', 'votre annonce') ||
        ' est en retard. L''équipe vous tiendra informé.',
      v_link
    )
    from public.properties p
    where p.id = v_a.property_id;

    perform public._notify_admins(
      'admin_final_payment_overdue',
      'Paiement final en retard',
      'Le paiement final sur ' || coalesce('« ' || v_title || ' »', 'une enchère') ||
        ' est en retard. Vérifier le dossier.',
      '/admin/payments'
    );

    update public.auctions set final_payment_overdue_at = v_now where id = v_a.id;
    v_late := v_late + 1;
  end loop;

  return json_build_object(
    'warn_7d', v_7d,
    'warn_1d', v_1d,
    'overdue', v_late,
    'at', v_now
  );
end;
$$;

revoke all on function public.notify_final_payment_due() from public;
grant execute on function public.notify_final_payment_due() to service_role;

-- ─── 10. cleanup_old_notifications — daily retention sweep ────────────────
-- Deletes notifications that are BOTH read AND older than 90 days.
-- Unread notifications are kept until the user marks them read (or until
-- they accumulate to a hard cap, which we don't enforce here).

create or replace function public.cleanup_old_notifications()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.notifications
   where read_at is not null
     and created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cleanup_old_notifications() from public;
grant execute on function public.cleanup_old_notifications() to service_role;

-- ─── 11. pg_cron schedules ─────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'batta-final-payment-due') then
      perform cron.unschedule('batta-final-payment-due');
    end if;
    perform cron.schedule(
      'batta-final-payment-due',
      '15 * * * *',  -- top-of-hour offset; checks every hour
      $cron$ select public.notify_final_payment_due(); $cron$
    );

    if exists (select 1 from cron.job where jobname = 'batta-cleanup-notifications') then
      perform cron.unschedule('batta-cleanup-notifications');
    end if;
    perform cron.schedule(
      'batta-cleanup-notifications',
      '0 3 * * *',  -- 03:00 UTC daily
      $cron$ select public.cleanup_old_notifications(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
