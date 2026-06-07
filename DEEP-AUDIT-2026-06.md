# Batta.tn — Deep Scalability & Correctness Audit (2026-06-07)

**Scope:** Can this webapp serve *tens of thousands* of users cleanly, and what bugs/glitches/defects stand in the way?
**Method:** 14-dimension multi-agent code audit (29 agents, ~2.5M tokens) — every finding **adversarially re-verified** against the real code; the 6 most severe re-confirmed by hand against the live SQL migrations. Plus a full ground-truth gate run (`typecheck` / `lint` / `test` / `build`).
**Result:** **64 confirmed findings**, 4 refuted. **1 Critical, ~11 High, ~18 Medium, ~34 Low.**

---

## Bottom line

**No — not shippable to tens of thousands of users today, but the gap is days of work, not a rewrite.**

The architecture is genuinely strong and, in places, unusually well-engineered for scale: CDN-cached cookieless public feeds with tag invalidation, a `FOR UPDATE`/`SKIP LOCKED` bidding-and-close core with exact `numeric(14,2)` money math, a singleton browser Supabase client with row-filtered realtime + a shared countdown ticker, code-split heavy frontend deps, fail-closed security gates (with a deliberately fail-open SMS gate), full error-boundary coverage, zero direct-Postgres connections, and an honest observability layer.

The blocker is **not raw load** — it's a small cluster of confirmed, individually launch-gating **correctness and security defects on the money-and-trust hot path**, most introduced by *late migrations that regressed earlier fixes*. The single worst: a stranger can become full platform admin with one signup call.

**Overall readiness: 4 / 10** — capability-gated by the Critical, not an average.

---

## The scorecard — 14 benchmarks, scored /10

Each benchmark: **10** = production-grade for tens of thousands of users; **0** = falls over immediately.

| # | Benchmark | Score | One-line reason |
|---|-----------|:----:|-----------------|
| 1 | **Security & Access Control** | **2 🔴** | One-call anonymous admin takeover (`0045`); forge-a-deposit RLS hole; bulk seller-PII scrape. |
| 2 | **Auction Engine Correctness** | **3 🔴** | Live tick-close (`0052`) dropped all win/sold notifications **and** never releases losing deposits. |
| 3 | **Payments & Money Integrity** | **4 🟠** | Buy-now after a deposit double-charges the buyer and inflates the seller ledger. |
| 4 | **Background Jobs & Cron Scaling** | **4 🟠** | Transactional email capped at 300/hr, **silently dropped after 24h**, serial sends with no timeout guard. |
| 5 | **Scalability — Realtime & Polling** | **5 🟡** | Per-auction bid channel fans out to every viewer + each viewer polls Postgres directly; no reconnect backoff. |
| 6 | **Scalability — Caching & Rendering** | **5 🟡** | Per-pageview `activity_log` write defeats the CDN savings; `/api/explore` + auction detail are uncached. |
| 7 | **Scalability — Database & Queries** | **6 🟡** | Public hot path is clean; admin/history pages fetch-to-filter-in-JS and silently truncate at scale. |
| 8 | **API Robustness & Input Validation** | **6 🟡** | Strong auth/CSRF/cron posture; bid placement has **no rate limit** and can stall a hot auction. |
| 9 | **Infra & Connection Management** | **6 🟡** | No direct-Postgres wall (all via REST); self-inflicted write-amplification + unguarded image optimizer. |
| 10 | **Code Quality & CI** | **5 🟡** | Gates are green — but they test only pure libs, so a Critical privesc + 2 money regressions shipped clean. |
| 11 | **Concurrency & Race Safety** | **7 🟢** | Bidding core is correctly locked; one missing advisory lock on `request_payout`. |
| 12 | **Observability & Operability** | **7 🟢** | Good coverage, honest benchmarks; the client-error sink is an unthrottled DB-write DoS. |
| 13 | **Frontend Performance & Memory** | **8 🟢** | No leaks; heavy deps code-split; only main-thread jank on low-end Android. |
| 14 | **Resilience & Error Handling** | **8 🟢** | Boundaries everywhere, hot pages degrade to a shell, all external fetches time out. |
| | **OVERALL** | **4 / 10** | Strong foundations; gated by the Critical/High security, auction-close, payment & email defects. |

---

## 🚨 Headline blockers — must fix before any real traffic

These are the defects that lose money, leak data, or hand over admin. Every one is a targeted SQL/route fix.

### B1 · CRITICAL — Anonymous full-admin takeover  `0045_signup_governorate.sql:18-37`
The live `_on_auth_user_created` trigger copies the **client-supplied** `role` out of signup metadata into `profiles.role`, **and** when `role='admin'` mirrors it into `auth.users.raw_app_meta_data` (the JWT claim).
```sql
role = coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'individual'::user_role)
...
if (new.raw_user_meta_data ->> 'role') = 'admin' then
  update auth.users set raw_app_meta_data = ... || jsonb_build_object('role','admin') ...
```
One unauthenticated `supabase.auth.signUp({ options:{ data:{ role:'admin' }}})` ⇒ passes `requireAdmin()` (reads `profiles.role`) **and** every `is_admin()` RLS/RPC gate (reads the JWT claim). Full read of all KYC docs, PII, payments; self-approve KYC; capture payments; control payouts. **This regresses the exact fix `0006` made (and was first re-broken in `0031`).**
**Fix:** new migration — hardcode `'individual'::user_role`, delete the `raw_app_meta_data` admin-mirror block. Then audit existing `profiles`/`auth.users` for any unprovisioned `role='admin'`.

### B2 · HIGH — Forge a deposit, bid/buy without paying  `0001_init.sql:457-460`
`deposits_self` is `for all` with `with check (auth.uid() = user_id or is_admin())` and **no INSERT/UPDATE revoke**. Any verified user `POST`s a fake `auction_deposits` row via PostgREST → gains bid + buy eligibility without paying; can also `UPDATE forfeited_at=null` to escape a forfeit.
**Fix:** `revoke insert, update, delete on public.auction_deposits from authenticated;` — make the service-role route + capture trigger the only writers (mirrors the existing `payments`/`sixth_offers` lockdown).

### B3 · HIGH — Live auction close is broken  `0052_auto_relist_unsold.sql:118-157`
The tick close branch sets `status` only — it emits **none** of the win/sold/reserve/sixth-offer notifications `0032` used to enqueue, and **never releases losing bidders' deposits** (only buy-now `0019:104-109` does). So for every English/sealed auction closing the normal way: winners are never told they won, and losers' cautions stay locked indefinitely until an admin manually runs the prepare action. At scale = unbounded manual backlog + customer money held hostage. (Also why those transactional emails never even enter the outbox.)
**Fix:** re-add the `0032` `enqueue_notification` blocks and the losing-deposit release into the close transition.

### B4 · HIGH — Buy-now double-charges + wrong ledger  `0019_buy_now_rpc.sql:104-109`, `checkout/page.tsx:155-160`, `0043:84-97`
Buy-now releases every losing deposit **except the buyer's own** (`user_id <> p_buyer_id`); the bidder's locked caution is neither netted nor refunded, but checkout charges the **full** `buy_now_price`, and `seller_earnings` counts that deposit. A bidder who deposited then clicks *Acheter maintenant* overpays by the deposit amount on every such sale, and the seller ledger is inflated.
**Fix:** net or refund the buyer's own deposit inside `close_auction_on_purchase`; make `seller_earnings` reflect the price actually paid.

### B5 · HIGH — Transactional emails throttled, then silently dropped  `cron/notify-email/route.ts:39,93-161`, `vercel.json:4`
The worker is capped at **50 emails/run × every 10 min = 300/hr** with a **24h cutoff that discards aged-out rows**, and makes **3 serial network calls per row with no `maxDuration`** (~150 serial calls ≈ 30s → a Resend latency spike kills the run mid-batch). A close/broadcast wave delays winner/payment/KYC emails for hours-to-days and **permanently loses** anything past 24h.
**Fix:** `export const maxDuration = 60`; batch/concurrent sends; raise cap + cadence; drop the 24h cutoff in favor of `MAX_ATTEMPTS`.

### B6 · HIGH — Bulk seller-PII scrape  `0005_public_profile_read.sql:16-27`
`profiles_public_read_actors` is a **row-level** `SELECT` policy granting anon read of any profile that is an agency/bank/bailiff, approved inspector, or owns a `ready` listing. RLS isn't column-level, so anon can `select phone, governorate, kyc_status, trust_score` for every active seller — the migration comment *assumes* those columns are "individually unselected," but a direct PostgREST query ignores that.
**Fix:** replace with a view/RPC (or column-level grants) exposing only `{id, full_name, role}`.

---

## Quick wins (high impact / low effort)

1. `revoke insert, update, delete on public.auction_deposits from authenticated;` — closes B2 in one migration.
2. Restore `0006`'s signup-trigger behavior (hardcode `individual`, drop the admin mirror) — ~5 lines, closes B1.
3. `export const maxDuration = 60` on `notify-email` (and the other crons) — stops mid-batch kills.
4. `create index if not exists auction_deposits_user_idx on public.auction_deposits (user_id);` — `/api/my-deposits` fires on every logged-in home paint and currently seq-scans.
5. `create index notifications_created_at_idx on notifications(created_at desc);` + switch admin notifications count to `estimated`.
6. Add `if (!isSameOrigin(req)) return 403` to `account/delete` (the only mutating route missing CSRF) and cap the notifications `PATCH` ids array at 500 (matching its `DELETE` sibling).
7. Make admin deposit-refund conditional: `.is('refunded_at', null)` and treat 0-rows as already-refunded — kills the double-refund race.
8. Per-IP rate limit on `/api/observability/client-error` (reuse `check_auth_ratelimit` from `0061`) — a client crash-loop is currently an unbounded DB-write storm.
9. Sample/remove the per-pageview `activity_log` INSERT in middleware (Vercel Analytics already covers traffic) — reclaims the highest-volume write competing with the bid RPCs.
10. Add a short per-user-per-auction cooldown inside `place_bid` so one account's bid flood can't serialize honest bidders behind the `FOR UPDATE` lock on a hot lot.

---

## Ground-truth gate run (CQ category)

| Gate | Result |
|------|--------|
| `pnpm typecheck` | ✅ exit 0 (strict TS, clean) |
| `pnpm test` | ✅ exit 0 — 87 tests / 9 files (pricing, auction-engine, iban, sameOrigin, rejection, search, tunisia…) |
| `pnpm build` | ✅ exit 0 — Turbopack, 83 pages |
| `pnpm lint` | ⚠️ 0 errors, **69 warnings** |

**Why Code Quality is only 5/10 despite green gates:** the tests cover *pure `src/lib` functions* — **none of the SQL RPCs where every blocker lives**. The gates passed green while shipping a Critical privesc (`0045`) and two money-flow regressions (`0052`, `0019`). That's the strongest possible evidence the test net doesn't reach the money/auction layer. The 69 lint warnings also include real React-19 correctness smells, not just style: ref access during render (`BidHistoryRealtime.tsx:290`, `ImageLightbox.tsx:186`), `markAllRead` used-before-declared (`NotificationBell.tsx:310`), missing `exhaustive-deps` (`BidComposer.tsx:656,760`), and ~30 `set-state-in-effect` cascading-render warnings.

**Build notes:** `middleware` is **deprecated** in Next 16.2 (migrate to `proxy`); `/[locale]/properties` (the catalogue) builds as **`ƒ Dynamic`**, not SSG — so every catalogue pageview runs a serverless function even though its *data* is `unstable_cache`'d.

---

## Full findings by category (all 64 confirmed)

> Severity is the **adversarially-corrected** severity (after a skeptic re-read the cited code). Locations are `file:line`.

### 1 · Security & Access Control — 2/10
- 🔴 **CRITICAL** Signup trigger self-grants admin from client metadata — `0045_signup_governorate.sql:18-37` (regression of `0006`; first re-broke at `0031:32-51`)
- 🟠 **HIGH** `auction_deposits` allows direct user INSERT/UPDATE → forge a deposit, bid without paying — `0001_init.sql:457-460`
- 🟠 **HIGH** `profiles_public_read_actors` exposes seller phone/governorate/kyc_status/trust_score to anon — `0005_public_profile_read.sql:16-27`
- ✅ *Strong:* all 18 `/api/admin/*` gate through `requireAdmin()`; sensitive tables have RLS; IDOR-prone file routes use the RLS-scoped server client.

### 2 · Auction Engine Correctness — 3/10
- 🟠 **HIGH** Live `tick_auctions` (`0052`) dropped all close/award notifications — `0052:37-197` vs `0032:532-785`
- 🟠 **HIGH** Losing deposits never released on normal (tick) close; only buy-now releases — `0052:118-157` vs `0019:104-109`
- 🟡 **MED** `bids_read` RLS exposes every bidder's `ip_address` (+ proxy `max_amount`) on non-sealed auctions, consumed by `select('*')` — `0001:466-479`; `BidHistoryRealtime.tsx:188`
- 🔵 **LOW** Proxy bidding is dead code — `resolveProxyBid`/`max_amount` never resolved; UI sends `{amount}` only — `auction-engine.ts:42-73`; `BidComposer.tsx:842`
- 🔵 **LOW** Winning bid `is_winning` never set on tick-closed English/sealed auctions — `0052:148-156` (only `0019:88-89` sets it)
- 🔵 **LOW** TOCTOU in seller cancel: bid can land between count-check and status flip — `auctions/[id]/cancel/route.ts:64-91`
- 🔵 **LOW** Stale `already_highest` error label after the self-raise rule landed — `BidComposer.tsx:44`
- ✅ *Strong:* exact `numeric(14,2)`, `timestamptz`, `FOR UPDATE`/`SKIP LOCKED`, no dead-end states.

### 3 · Payments & Money Integrity — 4/10
- 🟠 **HIGH** Buy-now double-charges a bidder's deposit + inflates seller earnings — `0019:104-109`; `checkout/page.tsx:155-160`; `0043:84-97`
- 🟡 **MED** Forfeited winner deposit still counts toward withdrawable `seller_earnings` — `0043:84-97` vs `admin/deposits/route.ts:127-138`
- 🟡 **MED** Reused pending payment keeps a stale amount → displayed/charged diverges after a settings change — `checkout/page.tsx:204-216` vs `143-178`
- 🔵 **LOW** Platform commission rate hardcoded in SQL (not admin-parametrable) — `0020:32-38`, `0043:79-80` *(violates the monetization-parametrable rule)*
- 🔵 **LOW** Admin manual-payment accepts arbitrary amount, no per-kind price validation — `admin/manual-payment/route.ts:35,46-48,121-145`
- ✅ *Strong:* `0057` RLS+trigger blocks client-forged `status='captured'`; `0041` partial-unique indexes stop duplicate payments; winner caution protected from refund on settled sale; money paths read `app_settings` direct.

### 4 · Background Jobs & Cron Scaling — 4/10
- 🟠 **HIGH** `notify-email`: 3 serial network calls/row, no `maxDuration` → serverless timeout mid-batch — `cron/notify-email/route.ts:114-161`
- 🟠 **HIGH** Email outbox capped 50/run/10min (300/hr) + 24h cutoff → backlog grows then silently dropped — `cron/notify-email/route.ts:39,93-102`; `vercel.json:4`
- 🟠 **HIGH** `0052` redefined `tick_auctions` without the close-notification enqueues → close emails never enter the outbox — `0052:37-197`
- 🟡 **MED** `tick_auctions`/`notify_*` process every due row serially in one txn, no per-run `LIMIT` → unbounded run after a cron outage — `0052:69-187`
- 🔵 **LOW** `notify-email` claims rows by SELECT only + non-atomic `email_attempts` increment → double-send under overlap — `cron/notify-email/route.ts:131,148,155-158`
- ✅ *Strong:* watchlist/admin/broadcast fan-out is set-based (`INSERT…SELECT`, no per-user loops); per-auction loops use `FOR UPDATE SKIP LOCKED`.

### 5 · Scalability — Realtime & Polling — 5/10
- 🟠 **HIGH** Per-auction `bids` INSERT channel fans out every bid to every viewer **and** each viewer polls Postgres directly (`profiles` join) — ~2,850 qps modeled at 10k viewers on one hot lot — `BidHistoryRealtime.tsx:97-147,179-244`; `BidComposer.tsx:590-656,679-760`; `0021:27-48`
- 🟡 **MED** No reconnect backoff/jitter + Realtime connection ceiling → thundering-herd reconnect collapses clients onto direct-DB polling — `client.ts:14`; `BidHistoryRealtime.tsx:99-143`; `NotificationBell.tsx:219-257`
- 🔵 **LOW** `LiveCountdown` runs its own `setInterval(1s)` per instance instead of the shared ticker — `LiveCountdown.tsx:23-28`
- 🔵 **LOW** `NotificationBell` 5-min poll ≈ 33 req/s baseline of authenticated `/api/notifications` at 10k tabs (bounded) — `NotificationBell.tsx:73`
- 🔵 **LOW** `StatusPoller` refreshes the auth session every 30s for up to 20 min — token-rotation load for a KYC cohort — `StatusPoller.tsx:35-41`
- ✅ *Strong:* all channels row-filtered, removed on unmount; polls adaptive + pause on hidden tabs; claimed intervals match the code.

### 6 · Scalability — Caching & Rendering — 5/10
- 🟡 **MED** Middleware writes an `activity_log` row on **every** non-prefetch pageview, defeating CDN/ISR savings — `middleware.ts:184-195` + `activity.ts:37-59`
- 🟡 **MED** `/api/explore` pagination/filter is uncached — every page jump/filter is a full join + `count:'exact'` — `explore/route.ts:76-131`
- 🟡 **MED** Auction detail fully dynamic, ~6-10 round-trips/view + undeduped uncached `generateMetadata` read — `auctions/[id]/page.tsx:35-59,114-377`
- 🔵 **LOW** `explore`/`properties` `SELECT *` pulls large `search_text` + `description` for every card — `explore/route.ts:83-90`; `properties/page.tsx:62-72`
- 🔵 **LOW** Public `/inspectors` roster is dynamic + uncached where ISR would suffice — `inspectors/page.tsx:10-30`
- ✅ *Strong:* home is ISR (revalidate 60); shared home queries + catalogue first page are `unstable_cache`'d with stable keys + tag invalidation; `app_settings` cached with money paths reading direct.

### 7 · Scalability — Database & Queries — 6/10
- 🟠 **HIGH** `/admin/payments` pulls up to 5000 joined rows, groups/filters/paginates in JS — silently truncates past ~3k payments — `admin/payments/page.tsx:42-74`
- 🟡 **MED** `/account/activity` fetches a user's entire bid+deposit history with no limit — `account/activity/page.tsx:54-76`
- 🟡 **MED** Seller dashboard fans out unbounded bid+watch counts via `.in()`, counts in Node — `sell/page.tsx:231-252`
- 🟡 **MED** Admin notifications list: `count:'exact'` + global `ORDER BY created_at` on the fastest-fan-out table, no matching index — `admin/notifications/list/route.ts:47-84`
- 🟡 **MED** `/admin/deposits` scans up to 1000 locked-deposit rows, groups in JS — silently misses auctions past the cap — `admin/deposits/page.tsx:132-166`
- 🔵 **LOW** `count:'exact'` across admin lists + public explore on growing tables (~8 counts/render on `/admin/properties`) — `explore:91`, `properties:71`, `admin/{users:64,properties:86/108-116/176-179,kyc-queue:56,payouts:59}`
- 🔵 **LOW** `explore`/`properties` `SELECT *` over-fetch (dup of caching #4) — `explore:83-90`; `properties:62-72`
- 🔵 **LOW** `/admin/properties` `sold` filter loads all sold property_ids into `.in()` — `admin/properties/page.tsx:99-102`
- 🔵 **LOW** `/account/payments` fetches all of a user's deposit rows with no limit — `account/payments/page.tsx:119-123`
- 🔵 **LOW** explore price filter uses `.or()` across three columns, defeating index use — `explore:118-127`; `properties:90-99`

### 8 · API Robustness & Input Validation — 6/10
- 🟡 **MED** Bid placement has **no rate limit** at route or RPC; `FOR UPDATE` lock lets one account's flood serialize honest bidders on a hot lot — `bid/route.ts:14-56`; `0050:25-65`
- 🔵 **LOW** `account/delete` (irreversible PII scrub + ban) missing the `isSameOrigin` CSRF guard — `account/delete/route.ts:23-31`
- 🔵 **LOW** Notifications `PATCH` passes unvalidated client ids into `IN()`, no length cap (DELETE sibling caps at 500) — `notifications/route.ts:81-85`
- 🔵 **LOW** `optimize-image` buffers the full body into memory before enforcing the 30MB cap — `optimize-image/route.ts:35-41`
- 🔵 **LOW** Many mutating routes return raw Postgres `error.message` to the client (schema recon) — `cancel:93`, `deposit:85,139`, `initiate-payment:170`, `payments/initiate:67`, `receipt:94`, `watchlist/[auctionId]:63`
- 🔵 **LOW** `popups/match` is a state-reading RPC POST with no same-origin guard — `popups/match/route.ts:25-42`
- ✅ *Strong:* all admin routes through `requireAdmin()`; all cron routes fail closed (503 if secret unset, 403 on mismatch); bid route enforces same-origin + RPC delegation.

### 9 · Infra & Connection Management — 6/10
- 🟡 **MED** Per-pageview `activity_log` INSERT in middleware is the highest-volume write, amplifying shared PostgREST/pool load on every authenticated nav — `middleware.ts:184-195` → `activity.ts:37-59`
- 🟡 **MED** `next/image` optimizer: broad `remotePatterns` (unsplash/picsum) + no rate limit → `/_next/image` transcode cost-amplification (denial-of-wallet) — `next.config.ts:42-49`
- 🔵 **LOW** No `maxDuration`/`preferredRegion` on any function; serial `notify-email` relies on the platform default timeout — repo-wide grep: no matches
- 🔵 **LOW** `observability/client-error` writes Postgres per request, no rate limit → crash-loop = DB write storm — `observability/client-error/route.ts:38-46`
- ✅ *Strong:* **zero direct-Postgres connections** (all via Supabase REST — the classic serverless connection-exhaustion failure mode doesn't apply); service-role client is a singleton; middleware skips `auth.getUser()`/Supabase for anon + prefetch.

### 10 · Code Quality & CI — 5/10
- Gates green (`typecheck`/`test`/`build` exit 0; lint 0 errors / 69 warnings) **but** tests cover only pure `src/lib` — none of the money/auction SQL RPCs, so the Critical + 2 money regressions shipped through clean.
- Pattern of late-migration regressions re-breaking prior fixes (`0045`↺`0006`, `0052` dropped `0032`/`0019`) → thin regression coverage on the RPC layer is the real process gap.
- Inconsistent guard/validation application across sibling routes (IN()-cap, `isSameOrigin`).
- Tested-but-unwired proxy-bidding engine ships as dead code (with a real PII side effect).

### 11 · Concurrency & Race Safety — 7/10
- 🟡 **MED** `request_payout` (`0020`) reads available balance and inserts **without** the per-seller advisory lock its sibling `admin_set_payout_status` (`0059`) has → concurrent requests over-reserve — `0020_seller_payouts.sql`
- 🔵 **LOW** Admin deposit refund is check-then-write, no `.is('refunded_at', null)` guard → double-refund signal + double notification — `admin/deposits/route.ts:59-123`
- 🔵 **LOW** Seller cancel TOCTOU (dup of auction-engine) — `cancel/route.ts:64-91`
- 🔵 **LOW** Proxy `max_amount` stored but never resolved (correctness, not race) — `0050:100-138`; `auction-engine.ts:42-73`
- ✅ *Strong:* `place_bid` / `place_sixth_offer` / `close_auction_on_purchase` / `tick_auctions` all `SELECT…FOR UPDATE`; close idempotent; deposit/payment dedup backed by partial unique indexes; `0059` payout transition hardened with advisory lock.

### 12 · Observability & Operability — 7/10
- 🟡 **MED** Client-error sink: no rate limit + service-role DB insert per hit → cheap unauthenticated log-flood / DB-write DoS on the fastest-growing table — `observability/client-error/route.ts:15-52` → `activity.ts:68-85`
- 🔵 **LOW** Per-navigation service-role `activity_log` write (amplification; 90-day prune bounds size, not rate) — `middleware.ts:184-195`
- 🔵 **LOW** No request-id/trace correlation across mw/api/err/client log lines — `log.ts`; `withRouteLogger.ts:31-42`; `instrumentation.ts:35-43`
- 🔵 **LOW** `activity_log` persists raw IP / full UA / referer / email — no redaction or documented retention — `activity.ts:88-94`; `0056:24-30`
- 🔵 **LOW** `BENCHMARKS.md` PERF-07 verification is false — cache hits emit no `hit≈0ms` log line (behavior correct, the documented check is unachievable) — `feed.ts:60-114`
- ✅ *Strong:* OBS-01..04, AUC-10/DB-05, OPS-02, SCALE-08 verified true; the `type='error'` constraint mismatch already fixed by `0061`.

### 13 · Frontend Performance & Memory — 8/10
- 🔵 **LOW** Face detection (~8/s) on the main thread during KYC selfie, no Web Worker → jank on low-end Android — `LivenessCheck.tsx:280-322,355-368`
- 🔵 **LOW** Batch image compression runs concurrently on the main thread (`Promise.all` over up to 10 multi-MB files) → multi-second freeze + OOM risk on low-memory phones — `SellForm.tsx:416-418`; `imageCompress.ts:124-196`
- 🔵 **LOW** `EndingSoonSlider` keeps every off-screen slide's `LiveCountdown` interval running — `EndingSoonSlider.tsx:77-88`
- ✅ *Strong:* singleton browser Supabase client (one WebSocket); consistent effect cleanup; shared ticker; dynamic-import code-splitting of face-api/heic2any. **No confirmed leaks.**

### 14 · Resilience & Error Handling — 8/10
- 🟡 **MED** A few `Promise.all` multi-fetch sites (auction detail, account/payments, admin dashboard) fail the whole render if any one query rejects (recoverable via error boundary)
- 🔵 **LOW** Client-side catalogue page-change fetch has no `catch` → silent dead-end on a transient failure — `ExploreGrid.tsx:188-213`
- 🔵 **LOW** Bell + watchlist/deposit polls lack the bid client's `AbortController` timeout — `NotificationBell.tsx:131,153`; `watchlistStore.ts:60`; `depositStore.ts:54`
- ✅ *Strong:* locale-root + global error boundaries; home/properties degrade to a static shell on timeout (`withTimeout` 2500ms); all external fetches carry `AbortSignal.timeout(10s)`; security gates fail closed, SMS gate fails open.

---

## Refuted by the verifier (4) — *not* problems
The adversarial pass cleared 4 candidate findings as already-mitigated or misread (e.g., claims contradicted by an existing constraint/lock/index/cache). The bidding-core locking, payment-forge lockdown (`0057`), and IDOR-safe file routes all held up under scrutiny.

---

## Suggested remediation order
1. **B1, B2, B6** (security) — one migration each, hours of work, highest blast radius.
2. **B3, B4** (auction close + buy-now) — restore the dropped `0032`/`0019` logic in the tick engine; these are money/trust.
3. **B5** + cron hardening (`maxDuration`, batching, drop the 24h cutoff).
4. **Process fix:** add pgTAP / integration tests over `place_bid`, `close_auction_on_purchase`, `tick_auctions`, `buy_now`, `request_payout`, and the signup trigger — the layer where every blocker lives and where CI is currently blind.
5. Then the Medium scalability items (per-pageview write, uncached explore, admin fetch-to-filter) for cost/latency at scale.

*Generated by a 14-dimension adversarially-verified multi-agent audit; the 6 headline blockers re-confirmed by hand against the live migrations.*
