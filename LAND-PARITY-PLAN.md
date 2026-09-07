# Mazed Land — bringing it level with Mazed Auto

Written 2026-09-07. Companion to this repo's `PIVOT-PLAN.md`, which set the
direction; this one is about **closing the gap with Auto**, and it is written
after measuring both codebases and both live databases rather than assuming
they are twins.

The short version: Land wants Auto's *system* and keeps its own *identity* and
its own *domain* — land and real estate. That part is settled and right. What
the measurements change is the **order of the work**, because the two products
are not in the same state and following Auto's sequence here would break a
live auction.

---

## 1. Where the two actually stand

Measured 2026-09-07 against both live Supabase projects (Land: `batta`,
eu-west-1 · Auto: `jxwsbmniubiuujeblwbt`). Separate projects — nothing here
touches Auto.

| | **Land** | **Auto** |
|---|---|---|
| `listings` | 29 (12 published, 17 draft) | 89 published |
| `categories` / `category_attributes` | 11 / 32 | 17 / 90 |
| `products` (pricing engine) | **does not exist** | 9 |
| `seller_credits`, `seller_badges` | **do not exist** | exist |
| `properties` (old) | **29 — still populated** | 0 |
| `auctions` | **295 · 18 live, 6 scheduled** | 0 |
| `bids` | 13 | 0 |
| `auction_deposits` | 7 | 0 |
| `payments` | 18 — **all `deposit_lock`** (8 captured) | 4 — all `listing_fee` |
| `kyc_submissions` | **50** (49 verified) | 2 |
| `inspectors` | 4 | 0 |
| `profiles` | 79 | 23 |
| Admin console | 18 sections, no kit | 13 sections, kit-based |

Land's pivot has landed 1a → 1c and a first catalogue (4a). The pricing
engine, the publish flow, the moderation queue and the admin rebuild have not
started.

---

## 2. The constraint everything bends around

**Land's auction product is live. Auto's was already dead when it was cut.**

- **24 lots are still running** — 18 live, 6 scheduled, ending in the future.
- **17 deposit payments exist and 8 are captured.** That is money held against
  lots that have not settled.
- 5 auctions are `awarded` and may still be completing.

When Auto was rebuilt, every auction table read zero, so screens could be
deleted the moment they stopped being useful. Here, deleting the deposits
queue, the payments console or the KYC review would break a product people are
using **and money we are holding**.

So Land's admin has to be a **deliberate hybrid** for a while: the new console
for annonces and publication fees, and the auction queues left standing until
the last lot settles. That is not untidiness — it is the only order that does
not strand a bidder.

Everything below is sequenced around it.

---

## 3. The port is not a copy — and this is the part that would have gone wrong

**Auto is a dark theme. Land is a light one.**

```
Auto   --background #0a0a0a   --gold #d4af37 (metallic gold)
Land   --background #ffffff   --gold #1e3a8a (blue-900 navy)
```

Land keeps the token *name* `--gold` while holding navy — so anything written
against `var(--gold)` ports for free and comes out navy.

The problem is everything I wrote for Auto that is **not** a token. Auto's kit
carries hardcoded hex chosen for a near-black ground:

| In Auto's kit | On Auto (#0a0a0a) | On Land (#ffffff) |
|---|---|---|
| `text-[#5cc98a]` (ok) | readable | **washed out, fails contrast** |
| `text-[#ef8681]` (bad) | readable | **washed out** |
| `text-[#e0a029]` (warn) | readable | **barely legible** |
| `bg-[rgba(212,175,55,0.06)]` (selected row) | subtle gold tint | **a gold tint on a navy product** |
| `.press { filter: brightness(1.08) }` | lifts off black | **washes toward white** |

Copying the kit as-is would produce a Land console that is technically working
and visually broken — the exact failure the Auto rebuild was undertaken to fix,
reintroduced by the fix itself.

**So the kit gets tokenised first, in Auto, where it can be verified against a
screen we already know.** Then the port is mechanical and both stay in sync
under `drift-check`.

---

## 4. Phases

Each leaves both products working. Effort is working days.

| # | Phase | Days | Blocked? |
|---|---|---|---|
| **A** | **Tokenise Auto's kit** — hardcoded hex → theme tokens, semantic tones defined per theme. Verified on Auto. | 1 | no |
| **B** | **Port the kit to Land** — `admin/kit/**`, `AdminShell`, `surface.ts`, `LinkPending`, `useAdminAction`, `tones`. Land's navy comes through `--gold`. | 1 | after A |
| **C** | **Shell, dashboard, Site hub** — Land's rail: the six Auto destinations **plus a temporary "Enchères" group** for the live auction queues. Dashboard counts Land's real queues, including deposits and the 1 pending KYC. | 1 | after B |
| **D** | **Pricing engine** — port Auto's `products` / `seller_credits` / `credit_ledger` / `seller_badges` migration, adapted: no `listing_fee_auction`, price per property category (a plot and a villa are not one fee). Then `/admin/offres`. | 2 | after C |
| **E** | **Moderation + publish** — `/admin/annonces` split-pane with the 10 actions, manual creation, `/admin/paiements` for listing fees. **The payments queue must show `deposit_lock` too** while auctions live, or 17 real payments vanish from the console. | 2 | after D |
| **F** | **Decommission** — auctions, deposits, inspectors, KYC. Screens, routes, tables, cron. | 2 | **BLOCKED** — see gate |
| **G** | **Cleanup** — docs, dead code, `drift-check --accept`, twin baseline refreshed. | 1 | after F |

**Total ≈ 10 days**, of which A–E (7 days) can start now.

### The Phase F gate

F does not open on a date. It opens when all three are true:

1. `select count(*) from auctions where status in ('scheduled','live','extending','sixth_offer_window')` returns **0** (currently 24).
2. Every `auction_deposits` row is refunded or forfeited — none merely `released`.
3. The 17 `deposit_lock` payments are settled; the 8 captured ones in
   particular have been refunded or converted.

Until then the auction console stays. A checklist query for this goes in
`RUNBOOK.md` in Phase C so it can be checked without asking.

---

## 5. What differs from Auto's plan, and why

- **`listing_fitments` is not ported.** A part fits a car; a building fits
  nothing. Already decided in `PIVOT-PLAN.md` and still right.
- **`condition` (neuf/occasion) does not describe a building.** Property uses
  `year_built` and the category attributes instead.
- **Price per category matters more here.** Auto could nearly get away with one
  fee; a plot at 40 000 TND and a villa at 900 000 cannot carry the same
  publication fee, so `products.category_id` is load-bearing from day one.
- **KYC is heavier.** Auto held 2 submissions. Land holds **50, of which 49 are
  verified** — real CIN images and selfies of 50 people. Deleting that is a
  data-protection decision, not an engineering one (see D2).
- **`properties` still holds 29 rows** mirroring `listings`. Two tables
  describing the same 29 objects is a source of truth waiting to disagree;
  Phase F retires `properties`, and nothing new should write to it before then.

---

## 6. Decisions I need from you

| # | Question | My recommendation |
|---|---|---|
| **D1** | The 8 **captured** `deposit_lock` payments — real money held against lots. Refund, forfeit, or convert to publication credit? | **Decide before Phase F opens.** This is the one item that can turn a technical cutover into a customer dispute. Converting to credit is the friendliest and keeps the money in the product. |
| **D2** | 50 KYC submissions, 49 verified — CIN photographs and selfies. | **Export, then purge**, as Auto did — but Auto's purge covered 2 people and this covers 50. Nothing in the classifieds product needs a verified identity, and holding ID images for a product that no longer verifies identity is a liability that grows. Needs your explicit word. |
| **D3** | Do the 24 running auctions play out, or get cancelled and deposits returned early? | **Let them play out.** Cancelling live lots with bids on them is worse for reputation than waiting; the code stays up either way. |
| **D4** | Should the admin kit be a **shared package** across both repos, or stay duplicated with `drift-check` policing it? | **Keep it duplicated for now.** The two themes differ enough that a shared package would need theming hooks on day one, and `drift-check` already exists and works. Revisit if a third surface appears. |
| **D5** | The 17 **draft** listings from the backfill — publish, or leave? | **Leave them.** They are properties that were never live as auctions; pushing them public without a moderation pass is how a catalogue fills with rubbish. They go through the Phase E queue like anything else. |

---

## 7. First commit if you say go

Phase A, in Auto, because it is verifiable there:

1. `kit/tones.ts` — tone hex values move behind CSS custom properties defined
   per theme (`--tone-ok`, `--tone-warn`, `--tone-bad`), so the same class is
   readable on both grounds.
2. `kit/surface.ts` — `ROW_SELECTED` and the flags stop hardcoding gold and use
   `var(--gold-faint)` / `var(--gold)`.
3. `globals.css` — `.press` brightness becomes direction-aware (lift on dark,
   dim on light); `.link-busy-*` already uses `color-mix` and needs nothing.
4. Verify on Auto: no visual change on the dark theme, because the tokens
   resolve to the same values they were hardcoded to.

Then Phase B is a file copy plus Land's own token values, and the Land console
comes up in navy on white without a single hex being retyped.
