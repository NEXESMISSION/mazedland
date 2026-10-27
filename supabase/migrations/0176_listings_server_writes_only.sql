-- ============================================================================
-- 0176 · An annonce out of draft changes only through the server
--
-- Since 2026-10-26, any change to an annonce that is online takes it offline
-- until an admin approves the change (src/lib/listings/edit.ts). That rule is
-- applied by /api/annonces/:id/edit, which writes with the service role.
--
-- The database still let a signed-in seller write their own rows directly:
-- 0146 gave owners an update policy on `listings` and a write policy on
-- `listing_photos`, and 0157 granted update on `listings` to `authenticated`.
-- Through the public API, a seller could change the price, the text or the
-- photos of a published annonce and skip the check entirely.
--
-- Nothing in the app writes either table as the signed-in user: every write
-- goes through a route on the service role, or through a security-definer
-- function. So the client roles keep the right to write drafts (private, and
-- checked when submitted) and lose it everywhere else. Admins (is_admin())
-- and the service role are unaffected.
--
-- The triggers are security invoker on purpose: `current_user` must be the
-- caller's role, not the function owner's. Idempotent.
-- ============================================================================

create or replace function public._listings_client_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if (tg_op = 'INSERT' and new.status is distinct from 'draft')
       or (tg_op = 'UPDATE' and (old.status is distinct from 'draft' or new.status is distinct from 'draft')) then
      raise exception 'listing_server_only'
        using errcode = 'P0001',
              hint = 'An annonce out of draft changes through the server routes (0176).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists _listings_client_write_guard on public.listings;
create trigger _listings_client_write_guard
  before insert or update on public.listings
  for each row execute function public._listings_client_write_guard();

create or replace function public._listing_photos_client_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  st text;
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    -- The annonce the photo goes to, or comes from: both must be drafts.
    if tg_op <> 'DELETE' then
      select l.status::text into st from public.listings l where l.id = new.listing_id;
      if st is distinct from 'draft' then
        raise exception 'listing_server_only'
          using errcode = 'P0001',
                hint = 'The photos of an annonce out of draft change through the server routes (0176).';
      end if;
    end if;
    if tg_op <> 'INSERT' then
      select l.status::text into st from public.listings l where l.id = old.listing_id;
      if st is distinct from 'draft' then
        raise exception 'listing_server_only'
          using errcode = 'P0001',
                hint = 'The photos of an annonce out of draft change through the server routes (0176).';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists _listing_photos_client_write_guard on public.listing_photos;
create trigger _listing_photos_client_write_guard
  before insert or update or delete on public.listing_photos
  for each row execute function public._listing_photos_client_write_guard();

comment on column public.listings.pending_edit is
  'A seller''s edit of a published annonce waiting for an admin: { fields, photos, flags }. Since 0176 the annonce is offline (pending_review) meanwhile, showing nothing until the edit is approved, refused or withdrawn.';

notify pgrst, 'reload schema';
