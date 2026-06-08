# Money/auction RPC integration suite

These tests exercise the SECURITY DEFINER PL/pgSQL RPCs that move money —
`place_bid`, `close_auction_on_purchase`, `seller_earnings`, `seller_balance`,
`request_payout` (and the `_on_payment_captured` / `_guard_payment_capture`
triggers they ride on) — against a **real local Supabase Postgres**, plus a
hermetic structural assertion that dangerous grants/policies are absent.

They are **not** in `pnpm test` (the unit gate stays infra-free). They run as a
separate vitest project (`--project rpc`) and a separate, **required** CI job.

## Why a full Supabase stack (not a bare postgres)

`supabase/migrations/**` is Supabase-specific: it references the `anon`,
`authenticated`, and `service_role` roles, `auth.uid()` / `auth.jwt()`, the
`auth` + `storage` schemas, and `pg_cron`. A plain `postgres:16/17` image cannot
apply them. The CI job and local runs both use the Supabase CLI local stack,
which applies every migration to a genuine Supabase Postgres.

## Run it locally

**Prerequisites:** Docker must be running (the Supabase CLI local stack runs in
containers), plus the Supabase CLI and pnpm.

```bash
# 1. Bring up the throwaway local stack (applies supabase/migrations/** in full)
supabase start

# 2. Export the stack's connection vars under the names the suite reads.
#    The local stack mints its own keys — nothing here is a real secret.
export SUPABASE_URL=$(supabase status -o env --override-name api.url=X | sed -n 's/^X=//p' | tr -d '"')
export SUPABASE_ANON_KEY=$(supabase status -o env --override-name auth.anon_key=X | sed -n 's/^X=//p' | tr -d '"')
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env --override-name auth.service_role_key=X | sed -n 's/^X=//p' | tr -d '"')
export SUPABASE_DB_URL=$(supabase status -o env --override-name db.url=X | sed -n 's/^X=//p' | tr -d '"')

# (or just `supabase status` and copy the printed API URL + anon/service keys;
#  SUPABASE_DB_URL defaults to postgresql://postgres:postgres@127.0.0.1:54322/postgres)

# 3. Run the suite
pnpm test:rpc

# 4. Tear down when done
supabase stop --no-backup
```

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are accepted as
fallbacks for `SUPABASE_URL` / `SUPABASE_ANON_KEY`.

## What it asserts

| File | Covers |
| --- | --- |
| `seller_earnings.test.ts` | A sale credits the seller **exactly once**: clean win (deposit kept + final payment), forfeit→re-enter→win (0094), buy_now + stray final_payment (0096), and a stranded buy_now (won by a higher bidder) credits 0. |
| `place_bid.test.ts` | Rejects below_min_increment / self_bid_forbidden / deposit_required / bid_too_fast / auction_closed; accepts a valid bid + a top-bidder self-raise; extends `ends_at` inside the anti-snipe window. |
| `close_auction_on_purchase.test.ts` | No-ops when `current_price >= buy_now_price` and when already terminal; clean buy-now sets winner + `ended_sold` and validates amount + deposit ≈ price. |
| `request_payout.test.ts` | Two concurrent requests can't reserve more than `available` (advisory lock); `available` never goes negative. |
| `structural_grants.test.ts` | **Hermetic, no secrets.** `authenticated` can't execute the 6-arg `enqueue_notification`; `anon` can't read `bids.ip_address`/`max_amount`; anon/authenticated can't INSERT a `captured` payment; a non-admin reads nothing of another user's profile. |

Fixtures are seeded per-test via the service-role client (RLS + the payment
guards off — exactly the production admin/manual-payment capture path) and torn
down in `afterEach` by deleting the throwaway users (FK cascade cleans the rest).
The structural test connects to the stack's Postgres directly with `pg`.
