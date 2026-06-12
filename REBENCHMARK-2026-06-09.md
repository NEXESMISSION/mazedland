# Batta.tn — Re-Benchmark (2026-06-09)

**Scope:** Re-run of the 2026-06-07 deep audit (`DEEP-AUDIT-2026-06.md`) against the current
`fix/scale-audit-blockers` branch — *did the launch blockers actually get fixed, and what's the new score?*
**Method:** Same 14-dimension frame. Every prior finding re-verified against the **current** code by
tracing each DB object to the **last migration that touches it** (120 migrations, 0001→0120; later
migrations override earlier `CREATE OR REPLACE` / `REVOKE`). 7 parallel verification agents, adversarial
(verify the SQL/source, don't trust commit messages). Plus a full ground-truth gate run.
**Delta since the audit:** ~40 fix commits, **39 new migrations (0081→0120)**, a new **RPC integration
test suite** (`tests/rpc/`) and a **live-exploit security gate** (`scripts/security-regression.mjs`).

---

## Bottom line

**Yes — the launch is no longer gated.** All **6 headline blockers (B1–B6)** from the audit, including the
single **Critical** (anonymous full-admin takeover), are **verifiably closed** at the last-touching
migration/source, with defense-in-depth (grant revoke + policy narrowing + `SECURITY DEFINER` funnels +
partial-unique-index backstops), and — crucially — the money/auction SQL layer where every blocker lived is
now covered by integration tests.

The 2026-06-07 score of **4/10** was *capability-gated by the Critical, not an average*. That gate is gone,
so the score now reflects the (severity-weighted) state of the code.

**Overall readiness: 8.5 / 10** — launch-ready on money/security/correctness. The one genuine remaining
*scale* ceiling is the **realtime layer under extreme single-lot concurrency** (per-auction bid fan-out is
measured but not reduced; no reconnect backoff), plus **ops-alerting wiring** left as a manual pre-launch
step. Neither loses money or leaks data.

---

## The scorecard — 14 benchmarks, /10 (audit → now)

| # | Benchmark | Audit | Now | What changed |
|---|-----------|:----:|:----:|--------------|
| 1 | **Security & Access Control** | 2 🔴 | **9 🟢** | B1/B2/B6 all closed; auctions/payouts/KYC/IBAN off realtime; close-RPC & reserve_price locked; JSON-LD XSS escaped. −1: CSP keeps `unsafe-inline/eval`. |
| 2 | **Auction Engine Correctness** | 3 🔴 | **9 🟢** | B3 fixed (tick close enqueues all notifs + releases losing deposits); Dutch honors reserve; cancel TOCTOU closed; bid PII off the wire; RPC-tested. −1: cosmetic `is_winning` not set on engine-closed lots. |
| 3 | **Payments & Money Integrity** | 4 🟠 | **9 🟢** | B4 fixed (buy-now nets the buyer's deposit); cross-kind double-capture blocked by unique index; seller_earnings settlement-gated + dedup'd; clawback ledger. −1: commission parametrable only at SQL, no admin UI. |
| 4 | **Background Jobs & Cron Scaling** | 4 🟠 | **9 🟢** | B5 fixed: `maxDuration=60`, cap 200, concurrency 8, atomic `FOR UPDATE SKIP LOCKED` claim (0111), dead-letter alert replaces 24h silent drop, per-run `LIMIT 500`. −1: cadence doc/config drift; non-email crons pg_cron-only. |
| 5 | **Scalability — Realtime & Polling** | 5 🟡 | **6 🟡** | Direct-DB poll is now a coalesced realtime-aware fallback; presence gated to live lots; bell poll 5 min. **Still open:** raw-`bids` per-auction fan-out unchanged; no reconnect backoff/jitter. |
| 6 | **Scalability — Caching & Rendering** | 5 🟡 | **9 🟢** | `/api/explore` + auction-detail shell now `unstable_cache`'d; pageview `activity_log` write env-sampled. Every hot public surface CDN/ISR-cacheable. |
| 7 | **Scalability — Database & Queries** | 6 🟡 | **8 🟢** | `/admin/payments` & `/admin/deposits` paginate in SQL (no more JS truncation); `bid_count` denorm + hot indexes (0098/0090/0119). Residual `exact` counts + per-user `account/activity` JS-grouping are bounded. |
| 8 | **API Robustness & Input Validation** | 6 🟡 | **9 🟢** | Bid rate-limited (0116); `account/delete` CSRF-guarded; notifications PATCH capped at 500; optimize-image pre-cap; raw Postgres errors redacted via `fail()` (unit-pinned). −1: `popups/match` anon by design. |
| 9 | **Infra & Connection Management** | 6 🟡 | **8 🟢** | image optimizer scoped + rate-limited (denial-of-wallet closed); crons bounded `maxDuration`; zero direct-Postgres. −1: no `/_next/image` edge limit, no region pinning. |
| 10 | **Code Quality & CI** | 5 🟡 | **9 🟢** | **The headline fix:** `tests/rpc/` integration suite (10 suites) exercises the money/auction `SECURITY DEFINER` RPCs as real signed-in clients; CI gates lint+typecheck+unit+**rpc**+build, plus a live-exploit security gate. −1: 69 lint warnings remain; 1 cross-route export. |
| 11 | **Concurrency & Race Safety** | 7 🟢 | **10 🟢** | `request_payout` + `reverse_settlement` now take the per-seller advisory lock its sibling had; refund is compare-and-set; backed by concurrent RPC tests. |
| 12 | **Observability & Operability** | 7 🟢 | **7.5 🟢** | client-error sink rate-limited; PII retention/scrub (0097); per-job heartbeats + unit-tested dead-man's-switch `/api/health`; dead-letter admin alert. Partials: request-id correlation wired to ~1 route; stale-heartbeat paging is a manual monitor TODO. |
| 13 | **Frontend Performance & Memory** | 8 🟢 | **8 🟢** | OffscreenCanvas + two-pass downscale + 30MB guard + throttled detection landed. The LOW main-thread items the audit named (face-detect, batch compress, off-screen countdown intervals) remain by design. |
| 14 | **Resilience & Error Handling** | 8 🟢 | **8 🟢** | ExploreGrid fetch now toasts on failure; bell/watchlist/deposit polls carry `AbortSignal.timeout`. `Promise.all` render paths still fail-all-on-one-rejection, but now caught by network-aware error boundaries. |
| | **OVERALL** | **4 / 10** | **8.5 / 10** | Critical/High money+security blockers closed and now test-covered; remaining gap is single-hot-lot realtime fan-out + ops-alerting wiring at extreme scale. |

Straight mean of the 14 ≈ **8.5**. Unlike the audit, there is **no Critical/High gate** pulling the headline below the average.

---

## Headline blockers (B1–B6) — status

| | Blocker | Status | Closed by |
|---|---------|:------:|-----------|
| **B1** | CRITICAL — anonymous full-admin takeover via signup metadata | ✅ **FIXED** | `0066`: role hardcoded `'individual'`, `raw_app_meta_data` admin-mirror deleted |
| **B2** | HIGH — forge a deposit via PostgREST | ✅ **FIXED** | `0067`: `revoke insert,update,delete on auction_deposits from authenticated,anon`; policy → `for select` |
| **B3** | HIGH — live tick-close dropped all notifications + never released deposits | ✅ **FIXED** | `0071`/`0078`: close branch enqueues won/sold/unsold/reserve/sixth-offer; `release_deposits_on_close` trigger |
| **B4** | HIGH — buy-now double-charges deposit + inflates seller ledger | ✅ **FIXED** | `0085` nets the buyer's deposit; `seller_earnings` (0102) settlement-gated; `0105` one-settlement-per-winner index |
| **B5** | HIGH — transactional emails throttled then silently dropped | ✅ **FIXED** | `maxDuration=60`, cap 200, concurrency 8, `MAX_ATTEMPTS` + dead-letter alert; atomic claim (0111) |
| **B6** | HIGH — bulk seller-PII scrape via public profile policy | ✅ **FIXED** | `0080`: drops `profiles_public_read_actors`; `public_profiles` view exposes only `{id, full_name, role}` |

A live re-exploit of B1/B2/B6 is wired as `pnpm test:security` (`scripts/security-regression.mjs`) — runs against a deployed env in CI, fails if any exploit succeeds.

---

## Ground-truth gate run (CQ category) — 2026-06-09

| Gate | 2026-06-07 | Now | Notes |
|------|-----------|-----|-------|
| `pnpm typecheck` | ✅ exit 0 | ✅ **exit 0** | strict TS |
| `pnpm test` (unit) | ✅ 87 tests | ✅ **111 tests / 13 files** | added jsonld, error-redaction, ladder-parity, health |
| `pnpm test:rpc` | ✗ did not exist | **suite exists** (10 files) | needs local Docker Supabase; gated in CI's `rpc-integration` job (not runnable on this host — no Docker) |
| `pnpm test:security` | ✗ did not exist | ✅ **18/18 PASS (live, 2026-06-09)** | ran against the configured Supabase project: B1–B13 exploits + positive controls all blocked |
| `pnpm build` | ✅ exit 0 | ✅ **exit 0** | ~83 pages |
| `pnpm lint` | ⚠️ 0 err / 69 warn | ⚠️ **0 err / 69 warn** | unchanged React-19 effect/ref smells |

**Why Code Quality jumped 5 → 9:** the audit's #1 process finding was *"the gates passed green while shipping a
Critical privesc + 2 money regressions because tests covered only pure `src/lib`."* That gap is closed — the
money/auction RPCs (`place_bid`, `tick_auctions`, `close_auction_on_purchase`, `request_payout`,
`seller_earnings`, sixth-offer, sealed, concurrency, structural grants) now have integration tests that run
against a real local Postgres in CI, **plus** a live-exploit security gate.

---

## Remaining items (none launch-gating; ordered by impact)

1. **🟡 Realtime bid fan-out unchanged (the top scale ceiling).** Every bid still broadcasts to every viewer of
   that lot over the raw `bids` realtime channel (`BidHistoryRealtime.tsx`, `BidComposer.tsx`,
   `0021_enable_realtime.sql`). The fixes throttled the *redundant poll* and moved *outbid fan-out* off the
   bid lock (0087/0088) — both real wins — but the N×M websocket fan-out the audit modeled (~2,850 qps at 10k
   viewers on one lot) is *instrumented, not reduced*. Fix path: a lightweight broadcast channel carrying only
   `{top_amount, bid_count, ends_at}` instead of full row INSERTs.
2. **🟡 No realtime reconnect backoff/jitter** (`supabase/client.ts`) — a Supabase blip risks thundering-herd
   reconnect → clients collapse onto direct-DB polling. Add `reconnectAfterMs` with jitter.
3. **🟡 Ops-alerting is built but not wired.** `/api/health` is a real dead-man's-switch and dead-letter raises
   an in-app+email admin alert, but **stale-heartbeat paging** is a manual "point an uptime monitor at
   `/api/health`" step in `RUNBOOK.md`. Confirm pg_cron is enabled in the deployed Supabase project (non-email
   crons depend on it) and wire the external monitor before launch.
4. **🟠 Commission rate is parametrable only at the SQL layer** (`batta_commission_rate()` reads `app_settings`
   and is clamped to [0, 0.95]), but there is **no admin-UI/API write path** — it's omitted from the
   `admin/settings` allowlist. This violates the *monetization-stays-parametrable* rule at the product level
   (an admin must edit the row via raw SQL). Add `commission` to the settings allowlist + form.
5. **🔵 request-id correlation wired to ~1 route** — `withRouteLogger` exists but only `/api/explore` populates
   the ALS store, so money-critical routes still lack cross-line trace correlation. Wrap the rest.
6. **🔵 notify-email cadence drift** — comment says `*/5` (≈2,400/hr), `vercel.json` schedules `*/10` (≈1,200/hr).
7. **🔵 Cosmetic** — `bids.is_winning` is never set on engine-closed (English/sealed/Dutch) lots, only buy-now;
   bid history won't highlight the winner. No money impact (`seller_earnings`/payouts key off
   `auctions.winner_user_id`).
8. **🔵 LOW perf (carried from audit)** — KYC face detection + batch image compression still on the main
   thread; `LiveCountdown` off-screen intervals don't pause; 69 React-19 lint warnings; one cross-route export
   (`sanitizePopupBody`).

---

## Suggested next order

1. **Realtime broadcast channel** (item 1) + **reconnect backoff** (item 2) — the only items that bite at the
   *tens-of-thousands-on-one-lot* scenario the benchmark targets.
2. **Wire ops alerting** (item 3) — pre-launch checklist, hours of work.
3. **Commission admin UI** (item 4) — closes the monetization-parametrable gap.
4. The 🔵 items as cleanup.

*Re-benchmark generated 2026-06-09 by a 7-agent adversarial re-verification of `DEEP-AUDIT-2026-06.md`
against the current `fix/scale-audit-blockers` branch; every B1–B6 closure re-confirmed at the live migration.*
