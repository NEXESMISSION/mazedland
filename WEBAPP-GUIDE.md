# Mazed Auto — Complete Web App Guide

> A full, plain-language walkthrough of every user type, every page, every action.
> This file is auto-generated from a code-verified audit (2026-06-12). The same
> guide applies to the twin project **mazed land** — swap the car wording for
> real-estate wording (carte grise → titre foncier, voiture → bien, etc.).

The platform is a **car auction marketplace for Tunisia** (French-only UI).
There are five kinds of people who use it, each unlocking more than the last:

1. **Visitor** — not logged in. Can browse everything, can't act.
2. **Logged-in user** — has an account. Can save, get notified, start KYC.
3. **Buyer** — a logged-in user who passed KYC, paid a caution, and bids.
4. **Seller** — lists cars (any logged-in user can sell; partners are pro sellers).
5. **Admin** — runs the platform from the `/admin` console.

Plus two specialist roles: **Inspector** (does car inspections) and **Partner**
(banks / dealerships / bailiffs — pro sellers with a portfolio dashboard).

---

## 1. The Visitor (not logged in)

A visitor can see almost the whole catalogue — gates only appear when they try to *act*.

### Home (`/`)
A long scrolling landing page (different layout on mobile vs desktop, same content):
auto-rotating hero carousel of trending auctions, a live activity ticker, stats bar,
VIP rail, "trending" / "hot now" / "direct offers" / "newly added" / "recently sold"
rails, "browse by type" and "browse by price" pills, a 3-step "how it works",
four trust pillars, "browse by make", and a final call-to-action band.
Every card → the auction page. Every filter pill → the catalogue pre-filtered.
**No login gate anywhere on the home page.**

### Catalogue (`/properties`)
The full searchable grid (2 columns mobile, 4 desktop, 12 per page).
- **Free-text search** (debounced) over title / city / address.
- **Filters:** type (sedan, suv, hatchback, pickup, van, coupe, convertible, wagon),
  governorate (24 wilayas), min/max price, fuel (gasoline/diesel/hybrid/electric),
  condition (new/excellent/good/fair/damaged), year range, max mileage.
- **Segment pills:** All · Auctions · Direct sales.
- Numbered pagination. The heart (watchlist) icon shows but does nothing until login.

### Auction detail (`/auctions/[id]`)
Anyone can see: the photo gallery, current/opening price, countdown, full specs,
the document list (but documents are **locked** — labelled "KYC + caution required"),
the anonymized seller trust card, the map, and the share button.
**The gates** — whatever a visitor clicks to act sends them to login:
- "Placer une enchère" → `/login` (then continues to the bid page after sign-in).
- The heart / watchlist → `/login`.
- "Achat immédiat" (if the lot has a buy-now price) → login then checkout.
- "Réserver une inspection" → login then booking.

### Content pages
`/about`, `/help` (collapsible FAQ in 6 sections), `/how-it-works`, `/pricing`,
`/contact`, `/partners` (pitch for banks/dealers/fleets), `/inspectors` (public roster
of accredited inspectors + "apply" CTA), `/privacy`, `/terms`, `/offline` (shown when
the device is offline). All public.

### Getting in
- **`/signup`** collects: full name, email, password, phone (+216 default), governorate,
  and acceptance of terms + privacy. If SMS verification is on, a 6-digit OTP step runs
  first. **Every new account is forced to role = `individual`** — you cannot self-assign
  a higher role (a database trigger enforces this; it's a security guarantee).
- **`/login`** supports two modes: email + password, or phone + password.
  "Forgot password?" link included.

---

## 2. The Logged-in User & the KYC gate

Once signed in, the user gets an **account hub** and the ability to verify identity.

### Account hub (`/account`)
Shows the identity card (name, email, KYC status pill, role pill) and three groups:
- **Mon compte** — KYC status + a role-specific shortcut (admins see "Console admin",
  partners see "Espace partenaire", inspectors see "Espace inspecteur", everyone else
  sees "Devenir inspecteur").
- **Acheteur** — Activity, Payments, Inspections.
- **Vendeur** — the seller dashboard.
- Sign out, and Delete account (scrubs personal data + identity documents).

### KYC verification (`/kyc/...`)
A wizard the user must finish before they can bid or sell:
**start → ID front photo → ID back photo → selfie (liveness check) → processing → status.**
KYC status has five values, each gating what's possible:
`none` → `submitted` → `pending` → **`verified`** (unlocks bidding & selling) or
`rejected` (must redo). The status page shows the verdict and the next step.

### Account sub-pages
- **Activity (`/account/activity`)** — tabs for bids in progress, won auctions
  ("gagnées"), and ended auctions ("terminées"). A `?focus=<id>` link rings the exact row.
- **Payments (`/account/payments`)** — every payment with its status (pending /
  in-review / captured / failed / refunded), receipt access, and a re-upload path for
  rejected receipts.
- **Inspections (`/account/inspections`)** — inspections the user booked, with status
  and a report download once the inspector submits it.
- **Notifications (`/account/notifications`)** — full notification feed with filters,
  mark-as-read, and delete.
- **Settings (`/account/settings`)** — change password, and the delete-account flow.

---

## 3. The Buyer — bidding, the caution, winning

This is the core flow. The bid page (`/auctions/[id]/bid`) walks the user through
**gates in order**, showing exactly one "do this next" card at each step:

1. **Not logged in** → "Sign in" card.
2. **Not KYC-verified** → "Verify your identity" card → the KYC wizard.
3. **Caution not paid** → "Pay the caution" card → checkout. The *caution* (deposit) is
   a refundable amount (a % of the opening price, set by admin) that proves the bidder is
   serious. Paid once per auction; refunded if they don't win; credited toward the price
   if they do.
4. **Registered but the auction hasn't opened yet** → "Vous êtes inscrit(e) ✓" with a
   **live countdown** ("ouverture dans J/H/MIN/SEC"). When the clock hits zero the page
   auto-switches into the live bid room (and a notification fires).
5. **Live** → the real **bid composer**.

### How the caution is paid (`/payment/checkout`)
Tunisia has no instant card rails here, so payment is **manual**: the page shows the
beneficiary's bank details (RIB / IBAN) and D17 number, the buyer makes the transfer,
then **uploads a receipt photo/PDF**. The payment sits in "review" until an admin
verifies it. On the "receipt sent" screen, the caution path shows a gold
**"Accéder à la page d'enchères"** button. When the admin validates, the buyer gets a
notification linking straight to the bid room.

### The three auction formats (for the bidder)
- **English (Anglaise)** — the standard, always available. Price rises with each bid;
  highest at close wins. The composer suggests the next minimum (current + increment),
  offers +5% / +10% quick presets, and updates instantly.
- **Sealed (Cachetée)** — secret offers, one per bidder, revealed at close; highest wins.
  *(Only available if the admin enabled it.)*
- **Dutch (Dégressive)** — price falls over time; first to accept wins immediately.
  *(Only available if the admin enabled it.)*

### When two people bid at once (the race panel)
If a bid is beaten in-flight (or is too low / too fast), instead of a tiny error toast
the composer shows an **integrated amber panel** right above the button explaining what
happened ("Quelqu'un a enchéri juste avant vous — le prix est maintenant X") with a
**one-tap re-bid** at the fresh minimum.

### Anti-sniping
On English & Sealed auctions, a bid in the final minutes (admin-set window, default 5 min)
extends the end time (default +10 min) so others can react. The status shows "extending".
Dutch auctions don't extend.

### Buy-now & direct sales
- A lot with a **buy-now price** can be purchased instantly (skips bidding) via checkout.
- **Direct-sale listings** aren't auctions at all — a fixed-price panel with a buy button.

### Winning — what happens next
When the buyer is the final winner, the auction page shows a clear highlighted
**"Que se passe-t-il maintenant ?"** explainer (both mobile and desktop):
- **14 days** to pay the balance, with the exact date.
- The math: **final price − caution already paid = balance owed**.
- ✅ If you pay → the car is officially yours (carte grise transfer).
- ❌ If you don't pay → **you lose your caution and your account is banned.**
- A "Payer le solde" button → final-payment checkout.

### The 1/6 sixth-offer window (only if the seller opted in)
Tunisian law allows a "surenchère du sixième": for a window after the sale, anyone can
reopen it by offering at least **1/6 (≈+16.7%) more** than the hammer price.
- The seller now **chooses** this per auction when scheduling (default **off**).
- **If off:** the winner is final immediately, pays within 14 days — the simple flow.
- **If on:** an 8-day window opens. Any KYC-verified bidder with an active caution can
  submit a sixth offer (the form lives on the `/bid` page). At the deadline, the highest
  sixth-offer wins (the original winner is notified + refunded); if none, the original
  winner is confirmed.

---

## 4. The Seller

Any logged-in, KYC-verified user can sell. Partners (banks/dealers/bailiffs) are pro
sellers with an extra portfolio dashboard.

### Seller dashboard (`/sell`)
- **Earnings card:** lifetime gross, net (after commission), commission rate, paid out,
  pending payout, and **available balance**.
- **Stats:** number of listings, live auctions, sold/awarded.
- **Action required:** rejected listings (with the reason + "Corriger l'annonce") and
  failed receipts ("Renvoyer le reçu").
- **My listings:** every car with its status (draft / pending review / ready / rejected /
  live), and a per-listing CTA: "Programmer l'enchère" (if approved), "Corriger" (if
  rejected), "Annuler l'enchère" (if it's scheduled/live with **zero bids**).
- **Payouts history** (last 10) with status pills.
- **"Demander un retrait"** (if balance > 0): enter amount + IBAN (validated) → payout request.

### Creating a listing (`/sell?new=1`) — a 2-step wizard
**Step 1:** choose Auction vs Direct sale (fee shown); for direct, set sale price +
"negotiable" flag. Then title, description, car type, the per-type characteristics
(admin-defined fields like mileage/fuel/transmission), governorate, address.
**Step 2:** photos (up to 10, auto-compressed to WebP), required legal documents (by car
type, e.g. carte grise), and optional **paid promotions** (home-featured / top-listed /
banner — only those the admin enabled). A fee breakdown totals it up.
On submit the listing is created as **pending review** and, if there's a fee, routes to
checkout to pay the listing fee (receipt upload, same as cautions).

### After submission
- **Admin reviews** the content + the fee receipt. Approve → status becomes **ready**.
  Reject → status **rejected** with a categorized reason.
- **Rejection is guided:** the edit page (`/sell/[id]/edit`) shows a red banner with the
  flagged categories and a "focused mode" that highlights only the sections to fix.
  Re-submitting a rejected listing starts a fresh fee payment.

### Scheduling the auction (`/sell/[id]/schedule`)
Once "ready", the seller schedules it:
- **Format:** English (always); Dutch/Sealed appear only if the admin enabled them. If
  only English is available, it shows as a single calm card (no pointless picker).
- **Price:** opening price (≥1000 TND), optional reserve price; Dutch has its own
  start/floor/decrement/tick fields.
- **Period:** start & end datetime (30 min – 60 days), with a live duration readout.
- **Sixth-offer (1/6) toggle** (English/Sealed only, default off) with a plain explanation
  of the trade-off (can raise your price vs. delays finalization).

### During & after the auction
- The seller sees a **"Tableau du vendeur"** banner on their own lot (instead of the bid
  UI): current price, bids received, active cautions, and — once sold — the buyer's
  payment status.
- **Cancel:** allowed only while there are **zero bids** (atomic check); notifies watchers,
  frees the lot to be re-scheduled at no extra cost.
- **Auto-relist:** an auction that ends unsold (no bids, or reserve not met) is
  automatically relisted after a random 1h–48h delay.
- **Payout:** after a sale completes, net proceeds become withdrawable; request a payout
  (amount + IBAN), and an admin processes it (requested → processing → paid, or rejected).

### Partners (`/partners/dashboard`)
Banks / dealerships / bailiffs get a portfolio view: their listings, live auctions, and
total GMV. They list/edit/schedule and request payouts like any seller. The partner role
is granted server-side (not self-service).

---

## 5. The Inspector

A specialist who inspects cars before auction.
- **Apply (`/inspectors/apply`):** speciality (mechanic / diagnostic center / appraiser /
  body shop), governorates served, bio, diploma + insurance PDFs.
- **Admin approves** → the user's role flips to `inspector` (one atomic action) and they
  appear on the public roster.
- **Inspector workspace (`/inspector`):** assignments in 4 buckets — Incoming (requested),
  Active (scheduled / in progress), Submitted, Approved. Actions: accept, decline, start
  visit, upload a PDF report, submit.
- **Buyer side:** on a live lot, a buyer can **book an inspection** (`/inspectors/book`):
  pick type (standard / full / virtual-live, each with a fee), an inspector in that
  governorate, and a time slot → pays the inspection fee → the inspector is notified.
  The report becomes downloadable from the buyer's inspections page once submitted.

---

## 6. The Admin

Everything runs from the `/admin` console (role = admin, enforced server-side).
The sidebar groups screens into **Enchères**, **Argent**, **Personnes**, **Système**.

### Dashboard (`/admin`)
A work-queue cockpit with backlog counts, overdue (>48h) badges, and today's intake,
linking to each queue: listings to review, payments to verify, refunds, seller payouts, KYC.

### Enchères (auctions)
- **Properties (`/admin/properties`)** — moderation queue (tabs: to validate / rejected /
  validated / sold / all). Open a listing (`/admin/properties/[id]`) to review photos,
  specs, documents, and the fee receipt. **Approve** (publishes the listing + captures the
  fee + applies promos in one action) or **Reject** (`/reject` form with 6 preset reasons,
  category tags that tell the seller which sections to fix, and a focused/full edit mode).
- **Payments (`/admin/payments`)** — receipts grouped by auction. Drill into
  `/admin/auctions/[id]` to validate or reject each receipt.
- **Deposits / cautions (`/admin/deposits`)** — three buckets: to prepare (ended auctions),
  pending (locked during the 1/6 window), to refund. On the auction page, "CautionActions"
  lets the admin **prepare**, **refund** (with an optional transfer reference), or
  **forfeit** (two-step confirm — permanent seizure if a winner walks away).

### Argent (money)
- **Payouts (`/admin/payouts`)** — seller withdrawal requests: claim, advance to
  processing, mark paid, or reject with notes.
- **Manual payment (`/admin/manual-payment`)** — record an offline payment (cash / check /
  wire) that's instantly captured, for caution / buy-now / final-payment.

### Personnes (people)
- **KYC queue (`/admin/kyc-queue`)** — review identity submissions (ID front/back + selfie
  via signed URLs), approve or reject with a reason; can "claim" an item.
- **Users (`/admin/users`)** — searchable directory with role / KYC / governorate filters
  (read-only; KYC review happens in its own queue).
- **Inspectors (`/admin/inspectors`)** — approve inspector applications (flips role).

### Système (system)
- **Settings (`/admin/settings`)** — the control panel: listing fees (auction/direct),
  promotions (cost + duration), caution (free/fixed/percent + an optional "free until"
  date), anti-snipe window/extension, **auction-format toggles** (English always on;
  Dutch & Sealed default off), and the payee bank details shown to payers.
- **Home (`/admin/home`)** — manually feature any published listing (home-featured /
  top-listed / banner, with expiry).
- **Documents & Characteristics** — edit the per-car-type catalogs of required legal
  documents and the spec fields sellers fill in.
- **Notifications (`/admin/notifications`)** — broadcast a custom notification to all users
  or by role; plus a full sent-history with delete / bulk-delete.
- **Popups (`/admin/popups`)** — create targeted popups (banner / modal / bottom-sheet)
  with scheduling, audience targeting (role/segment/page), and impression/click stats.
- **Activity log (`/admin/activity`)** — append-only audit trail of every action and page
  view (who, what, when, IP, device).
- **Waitlist** and a **Fraud** placeholder round out the console.

---

## 7. The invisible layer (automation the user feels but never clicks)

- **Auction state machine** — a cron (`/api/cron/auctions/tick`) runs every few minutes and
  drives every transition: opens scheduled auctions (notifying the seller, registered
  bidders, and watchers), closes ended ones (awarding a winner, opening or skipping the 1/6
  window per the seller's choice, or relisting unsold lots), and finalizes sixth-offer
  windows at their deadline.
- **Notifications** — ~54 distinct kinds, each routed to the right page on tap. Ten of them
  also go out by **email** via a digest cron (wins, payment accepted/rejected, KYC
  verified/rejected, final-payment reminders at T-7 / T-1 / overdue, etc.).
- **Caution lifecycle** — locked when paid; non-winners' cautions auto-release when the
  auction closes; the winner's caution is credited to the purchase; forfeited if they
  don't pay.
- **Payments model** — kinds: deposit (caution), buy-now, final payment, listing fee,
  inspection fee, commission, subscription; statuses: pending → in-review → captured /
  failed / refunded. Two manual methods: bank transfer and D17.
- **Rate limits** — bidding is capped at 90/min per IP and a 2-second per-user cooldown;
  SMS, signups, and image uploads have their own caps.
- **Realtime** — auctions, bids, and notifications stream live (price, bid count, and new
  bids update without a refresh); polling quietly backs it up and pauses when the tab is hidden.
- **PWA** — installable, works offline (cached shell + offline page), with app shortcuts.
- **Health monitoring** — every cron stamps a heartbeat; `/api/health` reports if any job
  goes stale.

---

*Generated 2026-06-12. Keep this in sync across both twin projects when workflows change.*
