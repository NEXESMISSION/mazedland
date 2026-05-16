# Batta.tn

Real-estate auction platform for Tunisia — English / Dutch / sealed-bid auctions plus direct fixed-price sales, with KYC, deposits, notary handoff, and a 1/6-surenchère window (Tunisian law).

Stack: **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage + Realtime) · next-intl (ar / fr / en, RTL)**.

---

## Dev quickstart

```bash
pnpm install
cp .env.example .env.local        # fill in Supabase keys, leave gateway keys empty
supabase link --project-ref <your-ref>
supabase db push                  # applies migrations 0001 → 0021
pnpm dev                          # http://localhost:3000
```

In dev, payment gateway keys can stay empty — the sandbox at `/payment/mock` simulates Konnect / Paymee / Flouci / D17 / manual transfer end-to-end (auto-captures via `/api/payments/mock-capture` so the `_on_payment_captured` trigger fires the same way a real webhook would).

## Required environment variables

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | from Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | from Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | service-role; used by webhook captures, KYC seed, mock-capture, payouts |
| `NEXT_PUBLIC_SITE_URL` | client + server | absolute site URL — gateways need this to build `successUrl` / `failUrl` |
| `KONNECT_API_KEY` / `KONNECT_WALLET_ID` | server | leave empty to use the mock provider |
| `PAYMEE_API_KEY` | server | same |
| `FLOUCI_APP_TOKEN` / `FLOUCI_APP_SECRET` | server | same |
| `D17_MERCHANT_ID` | server | same |

## Database

Supabase migrations live under `supabase/migrations/`. Apply with `supabase db push` after `supabase link`. The migrations cover:

- **0001** — core schema (profiles, properties, auctions, bids, deposits, payments, etc.) + RLS
- **0006** — security lockdown (place_bid RPC, profile guard, sealed-bid masking)
- **0007** — auction state machine + `_on_payment_captured` trigger
- **0015–0019** — KYC mirror bypass, kyc audit hardening, listing_type + buy_now_price, atomic auction close
- **0020** — seller payouts (earnings view + balance RPC + request_payout)
- **0021** — Realtime publication for live bid + admin queues

## Deploy on Vercel

1. Connect this repo to a Vercel project.
2. Set every env var from the table above in **Project Settings → Environment Variables** (Production + Preview).
3. Push to `main` — Vercel builds with `pnpm build` / serves with `next start`.
4. The cron in `vercel.json` ticks the auction state machine every minute (`/api/cron/auctions/tick`).
5. After first deploy, wire payment-provider webhooks at the Tunisian gateways' dashboards to `https://your-domain/api/payments/{konnect|paymee|flouci|d17}/webhook`.

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | Local dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript no-emit |
| `pnpm seed` | `scripts/seed.mjs` — sample data |
