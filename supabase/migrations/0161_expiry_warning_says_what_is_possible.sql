-- ============================================================================
-- 0161 · The J-3 expiry warning stops asking for something impossible
--
-- `expire_listings()` warns three days out with "Renouvelez-la pour rester
-- visible", linking to /account/listings. A seller who follows it finds no way
-- to renew, because /api/annonces/[id]/renew refuses a `published` annonce —
-- deliberately: renewal moves the row to `pending_payment` / `pending_review`,
-- which would take a paid, live annonce off the catalogue while it waits.
--
-- So the notification asked for an action the product does not offer for three
-- days, and the only thing to do was wait. It now says that: how long the
-- annonce stays up, and when renewing becomes possible. « Mes annonces » shows
-- the same date on the row.
--
-- Everything else about the function is unchanged — same J-3 selection, same
-- `_expiry_warned` flag, same expiry loop and counts.
-- ============================================================================

create or replace function public.expire_listings()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
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
      '/account/listings'
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
      '/account/listings'
    );
    v_expired := v_expired + 1;
  end loop;

  return json_build_object('ok', true, 'warned', v_warned, 'expired', v_expired);
end;
$fn$;
