# Batta → classifieds: the full plan

**Goal, in your words:** *"i dont want it to be auction platform any more, make it like the mazed auto"* — same product shape as Mazed Auto, but for land and real estate.

Everything below is measured against the live database (`sajxoovrsoacfnytiijv`) and both
codebases on **2026-09-07**, not estimated.

---

## 1. The finding that changes the plan

I had been treating the auction wind-down as a delicate money problem, gated behind
"don't strand a bidder". **That gate does not exist.** Measured:

| Question | Answer |
|---|---|
| Bids ever placed, on any auction, ever | **0** |
| Bids on the 24 live/scheduled auctions | **0** |
| Distinct bidders | **0** |
| `auction_deposits` rows | 7, from **3 users** |
| Who those 3 users are | `mohamed saif allah elleuchi` (admin, you), `saif admin` (admin, you), `saif 3` (+21658415522, your test account) |
| `deposit_lock` payments | 18, from those same 3 accounts, all dated 2026‑06‑01 → 2026‑06‑16 |
| Accounts created 2026‑05‑29 | **60 in one day** — a seed batch |
| Newest real account | 2026‑09‑01 |

**The auction product has never transacted with a real customer.** The 263 500 TND of
"captured" deposits are your own test rows. There is no bidder to strand, no caution to
refund, no dispute to avoid.

So the earlier caution — the conditional "Cautions à solder" rail link, the Phase F gate
in `LAND-PARITY-PLAN.md` — was protecting seed data. It cost nothing and it is now
removable. **The auction product can be deleted outright, the way Mazed Auto deleted
its own.**

That is the single biggest correction to how I was working, and it is why the plan below
is much shorter than the one I was following.

---

## 2. Where things stand

### Already shipped (3 commits, each with a clean production build)

| Commit | What |
|---|---|
| `e363b9c` | **Admin console is the classifieds console.** Six destinations matching Auto (Tableau de bord, Annonces, Paiements, Offres & prix, Catalogue, Vendeurs) + Site. `/admin/paiements` and `/admin/vendeurs` replace `/admin/payments` and `/admin/users`. Retired screens redirect instead of 404. Migrations `0150` (seller_credits, credit_ledger, seller_badges) and `0151` (`expire_listings()` — the 30-day lifecycle had been written down since 0146 and never ran). |
| `05bf58b` | **`/annonces/[id]` exists.** Every catalogue card had been a 404. Phone number is not in the HTML — revealed on click, logged, rate-limited. Migration `0152`: `contact_reveals`, `watchlist.listing_id`, `listing_views` + `listing_analytics`, `listings.reference` (BT-00042). |
| `d70d8ef` | **Sellers can publish.** `/annonces/nouvelle` (attribute-driven, autosaving), `/account/listings`, `/api/annonces/*`. "Vendre" in the tab bar, desktop CTA, account menu and home CTAs all now mean a fixed-price annonce. |

Also fixed in **Mazed Auto** (`8c96557`): `/admin/vendeurs` had been listing **nobody**
since it shipped — an ambiguous `seller_badges` embed that PostgREST refuses outright.
It hid because a Server Component streams its shell before its data layer, so the page
answered 200 with an empty list. `scripts/admin-queries-check.mjs` now runs every
screen's real `select()` against the live database in both repos; that is the only test
that catches this class of bug.

### What the two products hold right now

| | Auction | Classifieds |
|---|---|---|
| Objects | 295 auctions (24 live/scheduled) · 29 `properties` | 29 `listings` (12 published, 17 draft) |
| Photos | 29 `property_photos` | 29 `listing_photos` |
| Money | 18 `deposit_lock` payments, all yours | 0 fee payments yet |
| Supporting | 50 KYC dossiers · 4 inspectors · 7 deposits | 11 categories · 32 attributes · 8 products |

`properties` and `listings` describe **the same 29 objects** — 0147 backfilled one from
the other. Two tables for one thing is a source of truth waiting to disagree.

---

## 3. What is left, in order

### ~~Phase 1 — The home page stops selling auctions~~ ✅ `2ec8d26`

This is the first thing anybody sees, and today it says **"Première plateforme tunisienne
dédiée aux enchères immobilières"**, **"Explorer les enchères"**, and shows a live-auction
countdown rail.

| File | Work |
|---|---|
| `src/lib/home/feed.ts` | The 6 cached queries all read `auctions` + `properties`. Repoint at `listings`: published catalogue, newest, per-governorate coverage, count. This one swap makes every existing rail render annonces without touching the layout. |
| `src/app/[locale]/(home)/page.tsx` (1 182 l) | Hero stats: "Enchères en cours / à venir" → "Annonces en ligne / nouvelles cette semaine / gouvernorats". Trust pillars: escrow + KYC + surenchère are auction guarantees — replace with what a classifieds buyer is actually promised (annonces vérifiées, numéro jamais publié, vendeur vérifié, aucune commission). |
| `src/components/landing/HomeDesktop.tsx` (610 l) | Same, plus the auto-advancing "featured lot" showcase → featured annonce. |
| `messages/fr.json`, `ar.json`, `en.json` | **51 lines** carry auction language, including `tagline` and `heroSubtitle`. |

**Design is not touched.** Batta's navy-on-white palette, type and layout stay exactly as
they are — only what the page is *about* changes.

### Phase 2 — The catalogue becomes searchable ⟵ *next*

`/annonces` (293 l) is a bare grid: category chips, governorate chips, a sort. Auto has
`CatalogFilters` — price range, per-category attribute filters, debounced search with
skeleton feedback. Property needs it more than cars do: surface and pièces are how anyone
actually shops for a flat, and both are already in `category_attributes`.

Also missing versus Auto: `/account/favoris` (the heart on a card now writes to
`watchlist.listing_id`, but there is no page listing them), `/account/settings`,
`/account/notifications`.

### ~~Phase 3 — Delete the auction product~~ ✅ `936c913`, `248c0bd`

Now unblocked by §1. Mirrors what Auto did.

- **Routes:** `/auctions`, `/auctions/[id]` (1 051 l), `/auctions/[id]/bid`, `/properties`, `/sell` (814 l), `/sell/[id]/edit`, `/sell/[id]/schedule`, `/kyc/*` (7 pages), `/inspector`, `/inspectors/*`, `/account/bids`, `/account/wins`, `/account/inspections/*`, `/partners/*`, `/watchlist` — with redirects, not 404s.
- **Components:** `components/auction/` (5 158 l), `components/sell/` (2 734 l), `components/inspector/`, `components/kyc/`, `components/property/` partly — **≈9 000 lines**.
- **APIs & cron:** `/api/auctions/*`, `/api/my-deposits`, `/api/seller/payouts`, `/api/inspector/*`, `/api/cron/auctions/tick`, `/api/cron/notifications/{ending-soon,final-payment-due,kyc-pending,unscheduled}`.
- **Schema, last and separately:** `auctions`, `bids`, `auction_deposits`, `kyc_submissions`, `inspectors`, `inspection_reports`, `seller_payouts`, `properties`, `property_photos`, `property_attribute_kinds`. Export first, drop in a migration of its own, so it is one revert away.

### Phase 4 — Close the remaining gaps to Auto

`/pricing` (the price list `products` already backs), `/help`, `/how-it-works`, `/about`,
`/offline`. Then: drift baseline (`drift-check --init` — no baseline exists yet), and
`admin-queries-check.mjs` wired into CI so a broken select fails the build instead of
rendering an empty page.

---

### What Phase 3 actually turned up

Three bugs the deletion exposed, none of which a build or a type-check could
see:

| | |
|---|---|
| **`_listing_fee_captured` was never ported** | `/api/admin/paiements` came from Auto, whose comments say "the trigger does the cascade". Validating a receipt would have captured the payment and left the annonce in `pending_payment` **forever**. Nobody had hit it because Batta has no fee payments yet — it would have failed on the first one. Fixed in `0155`, then tested end to end: draft → payment → receipt → capture → `pending_review` → seller notified. |
| **`drop function if exists f(a,b)` silently drops nothing** | It matches on the argument list, and `if exists` turns a wrong signature into a no-op rather than an error. Six functions reported success and survived. `0154` drops them by `oid::regprocedure` selected by name, which takes every overload. |
| **A view over a *surviving* table blocked the drop** | `auction_watcher_counts` reads `watchlist.auction_id`, so it never appeared in a dependency scan of the doomed tables. Only enumerating every view in the schema found it. |

The KYC purge ran as authorised: 50 rows and all 20 real files exported to a
gitignored local directory, then 99 objects removed from the `kyc` bucket and
50 rows deleted. 45 of the 50 were `[STRESS]` seed rows naming `mock/*` paths
that were never uploaded — the export script classifies those separately from a
genuine missing file, because only the second kind should be allowed to block a
purge.

### Known gaps, deliberately not half-built

- **Promos are sold but not applied.** `products` still sells *promo accueil*,
  *top de la recherche* and *bannière*. `expire_listing_promotions` drove
  `properties.promo_*` and went with that table, so nothing now applies a
  purchased promo to a listing or expires it. Wiring it to `listings` is a
  feature, and inventing it inside a DROP migration is how a drop migration
  becomes a bug.
- **`/account/activity` is still auction-shaped** — its tabs are "En cours" and
  "Participées". Phase 2.

---

## 4. What I need from you

| # | Question | My recommendation |
|---|---|---|
| ~~**D1**~~ | ~~Delete the auction product outright?~~ | **Answered: yes. Done.** 20 001 lines and 16 tables removed. |
| ~~**D2**~~ | ~~The 50 KYC dossiers.~~ | **Answered: export then purge. Done.** Export kept at `kyc-export-2026-09-07/`, gitignored. |
| **D3** | The 60 seeded accounts and 295 seeded auctions. | **Delete the auctions, keep the accounts.** The accounts cost nothing and make the admin screens look real while you evaluate them. |
| **D4** | Should `/annonces` become the site root (`/`), or stay a section under a marketing home page? | **Keep the marketing home.** Auto does, and a classifieds home page that is only a grid has nowhere to say what the site is. |
| **D5** | The 17 draft listings from the 0147 backfill. | **Leave them as drafts.** They are properties that were never live; pushing them public without a moderation pass is how a catalogue fills with rubbish. They go through the queue like anything else. |

**D3–D5 still stand.** None of them blocks Phase 2, so that is what I am on.

---

*Supersedes the auction-preserving parts of `LAND-PARITY-PLAN.md`, whose Phase F gate was
written before the bid count was measured.*
