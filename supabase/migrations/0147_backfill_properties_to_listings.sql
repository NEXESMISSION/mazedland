-- ============================================================================
-- 0147 — Backfill: every property becomes a listing.
--
-- The catalogue is empty until the 29 properties already in the system are in
-- it. This copies them across with their photos, so the new surfaces have real
-- content the day they are built rather than a placeholder shelf.
--
-- THE PRICE. Properties carry no price of their own — that lived on the
-- auction. Each property's MOST RECENT auction is used, and its opening price
-- is the asking price, which is what it always was: the number the seller
-- wanted. `buy_now_price` wins where one was set, being the more direct
-- statement of "this is what it costs".
--
-- WHAT IS PUBLISHED AND WHAT IS NOT. A published listing must carry a phone
-- number — a listing nobody can call is worthless in a model where the buyer
-- telephones the seller, and 0146 enforces it as a constraint. Owners with a
-- phone on their profile get a published listing; the rest land in `draft` and
-- publish the moment a number is added. No number is invented.
--
-- Idempotent: a property already carried across is skipped, so a re-run adds
-- only what is missing.
-- ============================================================================

-- The publish guard from 0146 refuses any INSERT that lands in 'published'
-- unless it comes from service_role or an admin. It is right to: publication is
-- the product, and a seller must not hand it to themselves. A migration is
-- neither of those things and runs as `postgres`, so it is lifted here for the
-- length of this transaction and put straight back. Nothing else can slip
-- through in the meantime — the whole file is one transaction.
alter table public.listings disable trigger _listings_guard_publish;

-- One listing per property, from its latest auction.
with latest_auction as (
  select distinct on (a.property_id)
         a.property_id,
         coalesce(a.buy_now_price, a.opening_price) as asking_price
    from public.auctions a
   order by a.property_id, a.created_at desc
),
mapped as (
  select
    p.id            as property_id,
    p.owner_id,
    p.title,
    p.description,
    p.governorate,
    -- properties has no `delegation`; listings keeps the column for new
    -- listings to fill and this backfill leaves it null.
    p.address,
    p.lat,
    p.lng,
    la.asking_price,
    coalesce(p.sale_negotiable, false) as negotiable,
    pr.full_name    as contact_name,
    pr.phone        as contact_phone,
    -- The eight property_type values, each to its leaf category.
    case p.type
      when 'apartment'  then 'appartements'
      when 'house'      then 'maisons'
      when 'villa'      then 'villas'
      when 'land'       then 'terrain'
      when 'farm'       then 'fermes'
      when 'commercial' then 'locaux-commerciaux'
      when 'office'     then 'bureaux'
      when 'warehouse'  then 'depots'
    end as category_slug,
    -- Only the attributes that carry a value; a null in the jsonb is noise the
    -- form and the filters would both have to special-case.
    (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
        from (values
          ('area_sqm',   to_jsonb(p.area_sqm)),
          ('rooms',      to_jsonb(p.rooms)),
          ('bathrooms',  to_jsonb(p.bathrooms)),
          ('floor',      to_jsonb(p.floor)),
          ('year_built', to_jsonb(p.year_built))
        ) as t(k, v)
       where v is not null and v <> 'null'::jsonb
    ) as attributes
  from public.properties p
  join latest_auction la on la.property_id = p.id
  left join public.profiles pr on pr.id = p.owner_id
)
insert into public.listings (
  seller_id, category_id, title, description,
  price, price_on_request, negotiable, governorate, address, lat, lng,
  attributes, contact_name, contact_phone, contact_whatsapp, show_phone,
  status, published_at, expires_at
)
select
  m.owner_id,
  c.id,
  m.title,
  m.description,
  m.asking_price,
  m.asking_price is null,
  m.negotiable,
  m.governorate,
  m.address,
  m.lat,
  m.lng,
  m.attributes,
  m.contact_name,
  m.contact_phone,
  m.contact_phone,
  true,
  case when m.contact_phone is not null then 'published' else 'draft' end::public.listing_status,
  case when m.contact_phone is not null then now() end,
  case when m.contact_phone is not null then now() + interval '30 days' end
from mapped m
join public.categories c on c.slug = m.category_slug
where not exists (
  -- Idempotence without adding a column: a property is "already carried" if
  -- this seller already has a listing with the same title.
  select 1 from public.listings l
   where l.seller_id = m.owner_id and l.title = m.title
);

-- Photos follow their property's listing, matched the same way.
insert into public.listing_photos (listing_id, storage_path, caption, sort_order)
select l.id, ph.storage_path, ph.caption, ph.sort_order
  from public.property_photos ph
  join public.properties p on p.id = ph.property_id
  join public.listings   l on l.seller_id = p.owner_id and l.title = p.title
 where not exists (
   select 1 from public.listing_photos lp
    where lp.listing_id = l.id and lp.storage_path = ph.storage_path
 );

alter table public.listings enable trigger _listings_guard_publish;
