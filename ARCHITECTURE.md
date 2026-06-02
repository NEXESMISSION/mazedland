# Architecture

Batta.tn — a Tunisian real-estate auction & direct-sale marketplace. This doc
is the map: what the pieces are, where they live, and the non-obvious rules
that keep the app fast, cheap, and safe at scale.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, RSC) + React 19 |
| Language | TypeScript (`strict`) |
| Backend / DB | Supabase (Postgres + Auth + Storage + Realtime) |
| Styling | Tailwind v4 |
| i18n | next-intl (fr default, ar, en) — locale-prefixed routes |
| Tests | Vitest (unit, `src/lib/**`) |
| Hosting | Vercel (ISR + edge CDN) |

## Directory map

```
src/
  app/
    [locale]/            # All user-facing pages (locale-prefixed)
      (home)/            # Landing — ISR-cached (revalidate 60)
      auctions/[id]/     # Auction detail + /bid sub-route (realtime)
      properties/        # Catalogue (cached feed, see below)
      account/ admin/ kyc/ sell/ payment/   # Auth-gated areas
    api/                 # Route handlers (mutations, cron, webhooks)
      admin/             # Admin-only — guarded by requireAdmin()
      cron/              # Secret-authenticated background jobs
  components/            # UI, grouped by domain (auction/, landing/, admin/…)
  lib/                   # Framework-free logic + clients (the testable core)
  i18n/  middleware.ts   # Locale routing + auth refresh
supabase/migrations/     # 56 ordered SQL migrations — the DB is the source of truth
```

## Data layer — the DB is the source of truth

- **Three Supabase clients**, do not mix them up:
  - `lib/supabase/client.ts` → `getBrowserSupabase()` — browser, user session.
  - `lib/supabase/server.ts` → `getServerSupabase()` — RSC/route handlers, user
    session via cookies, **RLS-enforced**.
  - `lib/supabase/admin.ts` → `getServiceSupabase()` — service-role, **bypasses
    RLS**. Trusted server code only (cron, cached public reads, admin actions
    behind `requireAdmin`).
- **RLS everywhere** (93 policies). The hot, money-touching paths are SQL
  `RPC`s, not app-side logic: `place_bid`, the auction state machine, payout
  acceptance, notification fan-out. App code calls them; Postgres enforces the
  rules. When changing auction/bid/payment behavior, the migration is usually
  the real change.
- **Migrations are append-only and ordered** (`0001…0056`). Never edit a landed
  migration; add a new one.

## Caching & rendering (cost control)

The default instinct is *cache the shared, render-per-request only the personal*.

- **Home + catalogue feeds** are `unstable_cache`'d with the cookieless
  service-role client, keyed by their inputs (`getHomeFeed`, `getExploreFeed`),
  `revalidate: 60`. Per-user bits (saved hearts, login state) are filled in
  **client-side** after hydration via the watchlist store — so the server HTML
  is identical for everyone and CDN-cacheable.
- **`app_settings`** (admin-controlled monetization + anti-snipe) is read
  through `lib/settings.ts` (`getCachedMonetization` / `getCachedAntiSnipe`),
  `unstable_cache` + tag `app-settings`, invalidated instantly on admin save via
  `revalidateTag(APP_SETTINGS_TAG, "max")`. **Exception:** the money-charging
  paths (checkout amount, deposit + initiate-payment routes) read it *directly*
  — they must never act on a cached value.
- **Pricing math lives in `lib/pricing.ts`** and is pure + admin-parametrable.
  Never hardcode a fee/deposit; route it through pricing + `app_settings`.
- **Middleware** (`middleware.ts`) skips the Supabase `auth.getUser()` round-trip
  entirely for anonymous visitors (no auth cookie ⇒ nothing to refresh), so
  static pages stay CDN-fast.

## Realtime vs polling

- **Realtime is the primary live channel** (auction price/status, bids,
  notifications). Channels are always **row-scoped** with a `filter`
  (`auction_id=eq.…` / `user_id=eq.…`) — never whole-table, or a broadcast
  fans out to every client.
- **Polling is only a dropped-event safety net**, deliberately slow:
  - Bid composer/history reconcile at 7s (hot) / 30s (cold), not 1s.
  - NotificationBell polls every 5min (realtime covers the badge live).
  - Presence heartbeat: a single `AuctionPresencePing` per page, 35s.
  When adding live behavior, lean on realtime; if you add a poll, justify the
  interval — at 10k concurrent users a 1s poll is ~10k DB queries/second.

## Auth & gating

- Session refresh happens in `middleware.ts`; private areas (`/account`,
  `/kyc/*` steps, `/admin`) are gated there too.
- **KYC is manual, admin-only**: only the admin endpoint sets
  `kyc_status='verified'`; verified users are blocked from resubmission at the
  DB, middleware, and UI layers.
- **Admin API routes** all start with `requireAdmin(req)` (`lib/admin/guard.ts`)
  — same-origin + authenticated + role check, one place. Don't re-roll the
  inline block.
- Mutating routes call `isSameOrigin(req)`; cron routes authenticate with
  `CRON_SECRET` instead.

## Testing & CI

- `pnpm test` runs Vitest over `src/lib/**` — the pure, high-stakes logic
  (money math, IBAN, search sanitization, rejection encoding, same-origin).
  Add a test when you touch any of those.
- CI (`.github/workflows/ci.yml`) runs **lint → typecheck → test → build** on
  every PR to `main`. All four must pass; never merge red.
- Local gate before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Conventions

- **Edit sequentially**; run typecheck/build between non-trivial changes.
- **Errors as toasts**, not inline page blocks (`components/ui/Toast`).
- **Layouts are action-first**: surface what needs action up top; keep buyer and
  seller journeys separate.
- ESLint: correctness/dead-code = error; advisory (react-hooks@7 `purity` etc.,
  Next perf hints) = warning. Don't promote advisory rules to error without a
  cleanup plan.
