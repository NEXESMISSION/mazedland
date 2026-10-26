# Mazed Immo

Real-estate classifieds for Tunisia. A seller publishes an annonce at a displayed price, an admin checks it before it goes live, and a buyer reveals the seller's number on request — no commission, the seller pays for the publication.

Live: **https://mazedland.vercel.app** — deploys from `main`.

Stack: **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage) · next-intl (fr)**.

---

## Dev quickstart

```bash
pnpm install
cp .env.example .env.local        # every variable is explained in the file
pnpm dev                          # http://localhost:3000
```

`.env.example` is the complete list of what the code reads, grouped by what breaks without each one. A `.env.local` filled with the production keys points your local server — and every script in `scripts/` — at the **live** database.

## Database

Migrations live in `supabase/migrations/` and are applied by hand:

```bash
node scripts/apply-migrations.mjs 0162            # dry run
node scripts/apply-migrations.mjs --commit 0162   # applies, one transaction per file
```

It needs the `SB_*` variables (local tooling only — never in Vercel). The project started as an auction platform; `0153` and `0162` removed that product, so the early migrations describe tables that no longer exist.

## Payments

Gateway-free. The seller pays the publication fee by bank transfer or D17, uploads the receipt, and an admin validates it under `/admin/paiements`; the annonce then goes to moderation. Prices are set in `/admin/offres`, the payee's details in `/admin/settings`. Until real payee details are entered there, checkout refuses to take payment and `/admin` says so.

## Scheduled work

`pg_cron` runs the database-side jobs (hourly listing expiry, promotion expiry, notification and OTP clean-up) and calls `/api/cron/notify-sms` and `/api/cron/notify-email` every five minutes. Those routes require `CRON_SECRET`. See `RUNBOOK.md` for operations.

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | Local dev server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | ESLint · TypeScript · unit tests (Vitest) |
| `pnpm i18n:check` | Missing or unused translation keys |
| `pnpm launch:check` | Pre-launch checks against the database in `.env.local` |
