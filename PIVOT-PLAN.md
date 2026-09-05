# Mazed Land — the same pivot Mazed Auto made

Mazed Land is an **auction house for property**: lots, deposits, bidding, KYC,
an inspector network. Mazed Auto was the same product for cars and stopped being
one — it is now a classifieds marketplace where the price is shown and the buyer
telephones the seller. Land follows.

**What is being kept:** Land's own visual identity. Its colours, its type, its
look. This is not a re-skin — the two sites should stay recognisably different.

**What is being taken from Auto:** the *system*.

- the listings backend (categories, listings, photos, contact reveals, expiry)
- the pricing engine (publication fee, packs, verified badge)
- the publish flow and the moderation queue
- the rebuilt admin console
- the removal of the auction system, and of KYC with it

Auto's own `PIVOT-PLAN.md` is the blueprint; its migrations 0153–0156 are the
foundation being ported here, adapted for property.

---

## Progress log

Newest first.

### Phase 1a — Taxonomy · **DONE** 2026-09-05

`0145_listings_taxonomy.sql`, applied to Land's database (project
`sajxoovrsoacfnytiijv` — Land and Auto are separate Supabase projects, so
nothing here touches Auto).

`listing_status` enum · `categories` · `category_attributes`, with RLS, grants
and the seed.

**What is different from Auto.** Auto splits into vehicles and spare parts, and
a part carries `fitments` — which cars it fits. Property has no equivalent, so
that table is not ported. Property splits by what the thing *is*, because it
changes the questions worth asking:

| kind | asks for |
|---|---|
| `residential` | surface, pièces, salles de bain, étage, année |
| `land` | surface, constructible, titre foncier, viabilisé |
| `commercial` | surface, étage, année |

The eight `property_type` values from `0001_init` each map onto a leaf, so every
existing property has somewhere to land when it is backfilled.

**Verified against the live database, not assumed:** 11 categories (3 branches +
8 leaves), attributes covering 8/8 leaves — `area_sqm×8`, `rooms×3`,
`bathrooms×3`, `buildable×2`, `titled×2`, `serviced×2`, `floor×6`,
`year_built×6`.

> A bug this caught: the "Terrains" branch and the "Terrains" leaf were both
> slugged `terrains`. `slug` is unique and the seed uses `on conflict do
> nothing`, so the leaf was dropped **in silence** — the branch for actual plots
> of land ended up containing only farms. Counting the rows found it; reading the
> migration would not have. The leaf is `terrain` now.

---

## Phases

Adapted from Auto's plan. Each lands behind the auction product, which keeps
working until Phase 6 takes it out.

| # | Phase | State |
|---|---|---|
| 1a | Taxonomy — categories, attributes | **done** |
| 1b | Core — `listings`, `listing_photos`, `contact_reveals`, expiry job | next |
| 1c | Backfill — `properties` → `listings`, photos copied | after 1b |
| 2 | Pricing — publication fee, packs, verified badge | |
| 3 | Selling + moderation — publish flow, admin queue | |
| 4 | Public surfaces — catalogue, listing page, contact reveal | |
| 5 | Account + notifications | |
| 6 | Decommission — auctions, deposits, KYC, inspectors | |
| 7 | Cleanup — docs, dead code | |

### Phase 1b — Core (next)

Port Auto's `0154_listings_core.sql`:

- `listings` — the same columns, minus the vehicle-specific ones. `condition`
  (new/used/refurbished) does not describe a building; property wants
  `year_built` and the attributes instead.
- `listing_photos`
- `contact_reveals` — the anti-scraping log; `contact_phone` granted to
  `service_role` alone so the catalogue cannot be walked for numbers
- the publish guard: a seller cannot publish themselves, because publication is
  what is being sold
- `expire_listings()` + the schedule

`listing_fitments` is **not** ported.

### What we keep from the auction product

- manual receipt payments (RIB + D17 + receipt upload + admin capture) — the
  real payment rail in Tunisia, and it already works
- the notification/SMS pipeline (outbox, drains, per-thread dedupe, caps)
- the image pipeline
- phone OTP, moderation queue, rejection reasons, the seller attestation
- **Land's design language**
