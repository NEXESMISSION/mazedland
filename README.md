# Batta.tn

Real-estate auction platform for Tunisia — English / Dutch / sealed-bid auctions plus direct fixed-price offers, with KYC, deposits, notary handoff, and a 1/6-surenchère window (Tunisian law).

Stack: **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage + Realtime) · next-intl (fr only)**.

---

## Dev quickstart

```bash
pnpm install
cp .env.example .env.local        # fill in Supabase keys
supabase link --project-ref <your-ref>
supabase db push                  # applies all migrations
pnpm dev                          # http://localhost:3000
```

Payments are gateway-free: buyers transfer externally (bank wire or D17 mobile-money push), upload a receipt screenshot, and an admin verifies it under `/admin/payments`. The admin-set payee details (RIB, IBAN, D17 number) and the listing fees live in `app_settings` (manage via `/admin/legal-docs` and `/admin/settings`).

## Required environment variables

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | from Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | from Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | service-role; used by admin captures, KYC seed, payouts |
| `NEXT_PUBLIC_SITE_URL` | client + server | absolute site URL — used for emails / share links |

## Database

Supabase migrations live under `supabase/migrations/`. Apply with `supabase db push` after `supabase link`. The migrations cover:

- **0001** — core schema (profiles, properties, auctions, bids, deposits, payments, etc.) + RLS
- **0006** — security lockdown (place_bid RPC, profile guard, sealed-bid masking)
- **0007** — auction state machine + `_on_payment_captured` trigger
- **0015–0019** — KYC mirror bypass, kyc audit hardening, listing_type + buy_now_price, atomic auction close
- **0020** — seller payouts (earnings view + balance RPC + request_payout)
- **0021** — Realtime publication for live bid + admin queues
- **0026** — pay-per-post listings (app_settings + promo flags + accept/reject RPCs)
- **0028** — listing_type on properties (offer vs auction) + offer listing fee

## Deploy on Vercel

1. Connect this repo to a Vercel project.
2. Set every env var from the table above in **Project Settings → Environment Variables** (Production + Preview).
3. Push to `main` — Vercel builds with `pnpm build` / serves with `next start`.
4. The cron in `vercel.json` ticks the auction state machine every minute (`/api/cron/auctions/tick`).

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | Local dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript no-emit |
| `pnpm seed` | `scripts/seed.mjs` — sample data |
