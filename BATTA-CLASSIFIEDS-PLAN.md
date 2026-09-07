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

### Phase 1 — The home page stops selling auctions ⟵ *next*

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

### Phase 2 — The catalogue becomes searchable

`/annonces` (293 l) is a bare grid: category chips, governorate chips, a sort. Auto has
`CatalogFilters` — price range, per-category attribute filters, debounced search with
skeleton feedback. Property needs it more than cars do: surface and pièces are how anyone
actually shops for a flat, and both are already in `category_attributes`.

Also missing versus Auto: `/account/favoris` (the heart on a card now writes to
`watchlist.listing_id`, but there is no page listing them), `/account/settings`,
`/account/notifications`.

### Phase 3 — Delete the auction product

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

## 4. What I need from you

| # | Question | My recommendation |
|---|---|---|
| **D1** | Given zero bids and zero real deposits — **delete the auction product outright?** | **Yes.** §1 removes every reason not to. It is ~9 000 lines of code and 10 tables describing a product that never sold anything. Keeping it means every future change has to keep working in two shapes at once. |
| **D2** | The 50 KYC dossiers — CIN photographs and selfies. | **Export, then purge.** They were collected so a bidder could be held to a bid; nothing in a classifieds product needs them. Holding ID images for a flow that no longer exists is a liability that only grows. Needs your explicit word before I touch it. |
| **D3** | The 60 seeded accounts and 295 seeded auctions. | **Delete the auctions, keep the accounts.** The accounts cost nothing and make the admin screens look real while you evaluate them. |
| **D4** | Should `/annonces` become the site root (`/`), or stay a section under a marketing home page? | **Keep the marketing home.** Auto does, and a classifieds home page that is only a grid has nowhere to say what the site is. |
| **D5** | The 17 draft listings from the 0147 backfill. | **Leave them as drafts.** They are properties that were never live; pushing them public without a moderation pass is how a catalogue fills with rubbish. They go through the queue like anything else. |

**Nothing in Phase 3 or D2 happens until you answer.** Phase 1 and Phase 2 need no
decision from you, so unless you say otherwise I am starting on the home page now.

---

*Supersedes the auction-preserving parts of `LAND-PARITY-PLAN.md`, whose Phase F gate was
written before the bid count was measured.*
