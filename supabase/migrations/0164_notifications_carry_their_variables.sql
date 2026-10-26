-- ============================================================================
-- 0164 · Notifications carry what they say, so each reader gets their language
--
-- A notification is written once, in French, when it is queued: the bell, the
-- SMS drain and the e-mail drain all repeat that stored sentence. With an
-- Arabic site that is the wrong moment to choose a language — the same row is
-- read in the bell in whatever language the reader has open, and an SMS should
-- go out in the language the recipient uses.
--
-- So every producer now also stores the values its sentence interpolates —
-- the annonce's title, a date, an amount, a motif — under `payload.vars`. The
-- application renders the text from messages/{fr,ar}.json at read time
-- (src/lib/notifications/render.ts) and falls back to the stored title/body
-- for rows written before this migration or kinds it does not know. The
-- stored French is unchanged, so nothing reads differently until the code
-- that renders ships.
--
-- 1. profiles.language. The column defaulted to 'ar' and nothing ever sent a
--    language at signup, so every profile says 'ar' though every user so far
--    has used the French site. It is reset to 'fr', defaults to 'fr', and the
--    signup trigger accepts only 'fr' or 'ar' from the metadata (anything
--    else would trip the column's check and fail the signup). The app now
--    sends the signup page's locale, and the language switcher records the
--    choice of a signed-in user.
-- 2. _notify_admins gains a payload overload; the 4-argument form delegates.
-- 3. The seven SQL producers, re-created from their live definitions with one
--    change each: the payload.
--
-- Idempotent: create or replace throughout; the language reset touches only
-- rows that are not already 'fr'.
-- ============================================================================

-- ── 1. profiles.language ────────────────────────────────────────────────────
update public.profiles set language = 'fr' where language is distinct from 'fr';
alter table public.profiles alter column language set default 'fr';

create or replace function public._on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, full_name, phone, role, language, governorate)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'phone', null),
    -- HARDCODED: never trust client metadata for role (re-fix of 0006 C1).
    'individual'::user_role,
    -- The signup page's locale. Only values the column accepts, else French.
    case when new.raw_user_meta_data ->> 'language' in ('fr', 'ar')
         then new.raw_user_meta_data ->> 'language'
         else 'fr' end,
    coalesce(new.raw_user_meta_data ->> 'governorate', null)
  )
  on conflict (id) do nothing;

  -- NOTE: the 0045 `if role = 'admin' then update auth.users ...` mirror
  -- block is deliberately NOT recreated. The JWT admin claim is only ever
  -- set by trusted server-side flows.
  return new;
end;
$function$;

-- ── 2. _notify_admins with a payload ────────────────────────────────────────
create or replace function public._notify_admins(
  p_kind text, p_title text, p_body text, p_link text, p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count int := 0;
begin
  insert into public.notifications (user_id, kind, title, body, link, payload)
  select p.id, p_kind, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb)
    from public.profiles p
   where p.role = 'admin';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public._notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns integer
language sql
security definer
set search_path = public
as $function$
  select public._notify_admins(p_kind, p_title, p_body, p_link, '{}'::jsonb);
$function$;

revoke execute on function public._notify_admins(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._notify_admins(text, text, text, text, jsonb) to service_role;
revoke execute on function public._notify_admins(text, text, text, text) from public, anon, authenticated;
grant execute on function public._notify_admins(text, text, text, text) to service_role;

-- ── 3. Producers ────────────────────────────────────────────────────────────

-- 0161 · J-3 warning and expiry.
create or replace function public.expire_listings()
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_warned  int := 0;
  v_expired int := 0;
  r         record;
begin
  -- ── J-3: what happens, and when it can be acted on ───────────────────────
  for r in
    select id, seller_id, title, expires_at
      from public.listings
     where status = 'published'
       and expires_at is not null
       and expires_at <= now() + interval '3 days'
       and expires_at > now()
       and coalesce((attributes->>'_expiry_warned')::boolean, false) = false
     for update skip locked
  loop
    perform public.enqueue_notification(
      r.seller_id,
      'listing_expiring',
      'Votre annonce expire bientôt',
      format('« %s » reste en ligne jusqu''au %s. Vous pourrez la renouveler dès ce jour-là.',
             r.title, to_char(r.expires_at, 'DD/MM')),
      '/account/listings',
      jsonb_build_object('vars', jsonb_build_object('title', r.title, 'expires_at', r.expires_at))
    );
    update public.listings
       set attributes = attributes || jsonb_build_object('_expiry_warned', true)
     where id = r.id;
    v_warned := v_warned + 1;
  end loop;

  -- ── The expiry itself ────────────────────────────────────────────────────
  for r in
    select id, seller_id, title
      from public.listings
     where status = 'published'
       and expires_at is not null
       and expires_at <= now()
     for update skip locked
  loop
    update public.listings
       set status = 'expired',
           attributes = attributes - '_expiry_warned'   -- so a renewal warns again
     where id = r.id;

    perform public.enqueue_notification(
      r.seller_id,
      'listing_expired',
      'Annonce expirée',
      format('« %s » n''est plus visible. Renouvelez-la pour la remettre en ligne.', r.title),
      '/account/listings',
      jsonb_build_object('vars', jsonb_build_object('title', r.title))
    );
    v_expired := v_expired + 1;
  end loop;

  return json_build_object('ok', true, 'warned', v_warned, 'expired', v_expired);
end;
$function$;

-- 0155 · A captured listing fee moves the annonce to review.
create or replace function public._listing_fee_captured()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
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
        '/account/listings',
        jsonb_build_object('vars', jsonb_build_object('title', v_title, 'variant', 'captured'))
      );
    exception when others then
      raise warning 'listing fee capture notification failed for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$function$;

-- 0026 · An admin refuses a listing-fee receipt.
create or replace function public.reject_listing_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pay      record;
  v_admin_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin_id := auth.uid();

  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  select id, user_id, kind, status into v_pay
  from public.payments where id = p_payment_id for update;
  if v_pay.id is null then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_pay.kind <> 'listing_fee' then
    raise exception 'wrong_kind' using errcode = '22023';
  end if;
  if v_pay.status not in ('pending', 'pending_review') then
    raise exception 'already_resolved' using errcode = '22023';
  end if;

  update public.payments
     set status      = 'failed',
         admin_notes = p_reason,
         reviewer_id = v_admin_id,
         reviewed_at = now()
   where id = p_payment_id;

  perform public.enqueue_notification(
    v_pay.user_id,
    'listing_payment_rejected',
    'Reçu refusé',
    'Motif : ' || p_reason || '. Vous pouvez téléverser un nouveau reçu.',
    '/payment/checkout?payment=' || p_payment_id::text,
    jsonb_build_object('vars', jsonb_build_object('reason', p_reason))
  );
end;
$function$;

-- 0153 · A receipt arrives: acknowledge the payer, alert the admins.
create or replace function public._on_payment_pending_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_what text;
begin
  if new.status = 'pending_review'
     and (old.status is null or old.status is distinct from 'pending_review') then

    -- Buyer ack lands on /account/payments. payload.focus tells the list page
    -- which row to ring + scroll into view.
    perform public.enqueue_notification(
      new.user_id,
      'payment_receipt_received',
      'Reçu reçu',
      'Votre reçu de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a bien été reçu. Notre équipe le vérifiera sous 24-48h.',
      '/account/payments',
      jsonb_build_object(
        'focus', new.id::text,
        'vars', jsonb_build_object('amount', new.amount)
      )
    );

    v_what := case new.kind::text
                when 'listing_fee'   then 'frais d''annonce'
                when 'listing_pack'  then 'forfait'
                when 'badge'         then 'badge vendeur'
                when 'promo'         then 'mise en avant'
                when 'renewal'       then 'renouvellement'
                when 'subscription'  then 'abonnement'
                else 'paiement'
              end;

    perform public._notify_admins(
      'admin_receipt_pending',
      'Nouveau reçu à vérifier',
      'Un reçu de ' || v_what || ' (' ||
        to_char(new.amount, 'FM999G999G990D00') || ' TND) attend votre validation.',
      '/admin/paiements',
      jsonb_build_object('vars', jsonb_build_object('paymentKind', new.kind::text, 'amount', new.amount))
    );
  end if;
  return new;
end;
$function$;

-- 0156 · A promotion runs out.
create or replace function public.expire_listing_promotions()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count int := 0;
  v_l     record;
begin
  for v_l in
    select id, seller_id, title
      from public.listings
     where promo_expires_at is not null
       and promo_expires_at <= now()
       and (promo_home_featured or promo_top_listed or promo_banner)
     for update skip locked
  loop
    update public.listings
       set promo_home_featured = false,
           promo_top_listed    = false,
           promo_banner        = false,
           promo_expires_at    = null,
           promo_manual        = false,
           updated_at          = now()
     where id = v_l.id;

    -- Best-effort: a notification failure must never leave a promotion live.
    begin
      perform public.enqueue_notification(
        v_l.seller_id,
        'promo_expired',
        'Mise en avant terminée',
        'La mise en avant de « ' || v_l.title || ' » a expiré. '
          || 'Votre annonce reste en ligne.',
        '/annonces/' || v_l.id::text,
        jsonb_build_object('vars', jsonb_build_object('title', v_l.title))
      );
    exception when others then
      raise warning 'promo expiry notification failed for %: %', v_l.id, sqlerrm;
    end;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- 0150 · Packs run out; a badge is about to lapse.
create or replace function public.expire_credits_and_badges()
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_credits int := 0;
  v_badges  int := 0;
  r record;
begin
  for r in
    select id, seller_id, quota_total - quota_used AS left_over
      from public.seller_credits
     where status = 'active' and expires_at <= now()
     for update skip locked
  loop
    update public.seller_credits set status = 'expired' where id = r.id;
    insert into public.credit_ledger (seller_credit_id, delta, reason)
    values (r.id, -r.left_over, 'expire');
    perform public.enqueue_notification(
      r.seller_id, 'credits_expired', 'Forfait expiré',
      format('Vos %s publication(s) restantes ont expiré.', r.left_over),
      '/account/listings',
      jsonb_build_object('vars', jsonb_build_object('count', r.left_over)));
    v_credits := v_credits + 1;
  end loop;

  -- J-7 warning on a badge about to lapse. Marked in `note` so it fires once.
  for r in
    select id, seller_id, expires_at
      from public.seller_badges
     where revoked_at is null
       and expires_at between now() and now() + interval '7 days'
       and coalesce(note, '') not like '%[warned]%'
     for update skip locked
  loop
    perform public.enqueue_notification(
      r.seller_id, 'badge_expiring', 'Votre badge expire bientôt',
      format('Le badge « Vendeur vérifié » expire le %s. Renouvelez-le pour le garder.',
             to_char(r.expires_at, 'DD/MM')),
      '/account',
      jsonb_build_object('vars', jsonb_build_object('expires_at', r.expires_at)));
    update public.seller_badges set note = coalesce(note, '') || ' [warned]' where id = r.id;
    v_badges := v_badges + 1;
  end loop;

  return json_build_object('ok', true, 'credits_expired', v_credits, 'badges_warned', v_badges);
end;
$function$;
