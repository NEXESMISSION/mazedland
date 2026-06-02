# Batta.tn — Benchmark Suite (acceptance criteria)

The bar this app must clear before every release / before scaling. Each item has
an **ID**, a **measurable pass criterion**, and **how to verify**. These are
specific to Batta.tn (Tunisian real-estate auction marketplace: English/Dutch/
sealed auctions, the sixth-offer rule, manual-receipt payments, KYC, deposits,
seller payouts, French UI, Supabase RLS + realtime + pg_cron).

Legend — verify with: `curl`/`autocannon` (load), `vitest` (unit), SQL/`supabase`
(DB), browser/`preview` (UX), manual (admin/flow walk-through).

---

## 1. Performance & Core Web Vitals
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| PERF-01 | Home `/fr` LCP (mobile, 4G) | ≤ 2.5 s | Lighthouse / PageSpeed |
| PERF-02 | Home INP | ≤ 200 ms | field data / Lighthouse |
| PERF-03 | Home/catalogue/auction CLS | ≤ 0.1 | Lighthouse |
| PERF-04 | TTFB on ISR-cached pages (home, catalogue, auction) | ≤ 200 ms (edge cache hit) | `curl -w %{time_starttransfer}` |
| PERF-05 | First-load JS (gzip) on home | ≤ 320 KB (target ≤ 250 KB) | sum `/_next/static/*.js` gzip |
| PERF-06 | Home HTML (gzip, over the wire) | ≤ 50 KB | `curl --compressed -w %{size_download}` |
| PERF-07 | Cached pages serve without a DB round-trip on cache hit | `getHomeFeed`/`getExploreFeed` log `hit≈0ms` | server log |
| PERF-08 | Property images delivered as AVIF/WebP, not oversized | each ≤ 80 KB; no >1920px variant for cards | network panel |
| PERF-09 | No layout shift from late-loading hero/carousel | hero reserves space; CLS≈0 | visual |

## 2. Scalability & Load
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| SCALE-01 | Cached pages under 100 concurrent | 0 errors, 0 non-2xx | `autocannon -c 100` |
| SCALE-02 | Static route raw throughput (single instance floor) | ≥ 500 req/s | `autocannon /robots.txt` |
| SCALE-03 | DB-bound API (`/api/explore`) latency @ 10 concurrent | p99 ≤ 500 ms, 0 errors | `autocannon -c 10` |
| SCALE-04 | DB queries per page render | home ≤ 6 (cached to ~0), auction detail ≤ 4, bid page ≤ 4, catalogue ≤ 1 (cached) | code review + log |
| SCALE-05 | Realtime channels held per user | ≤ 1 browsing, ≤ 3 on bid page (all row-filtered) | grep `.channel(` + DevTools |
| SCALE-06 | Steady-state client polls are safety-nets, not live | NotificationBell ≥ 5 min, bid 7 s/30 s, presence ≥ 35 s | code constants |
| SCALE-07 | Hot single auction sustains bid load | ≥ dozens bids/s without lost/duplicate bids or wrong winner | concurrent `place_bid` test |
| SCALE-08 | No N+1 / unbounded `count: exact` on growing tables | activity_log uses estimated count; lists paginate | code review |

## 3. Auction Engine Correctness (core — money depends on it)
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| AUC-01 | English: next bid must be ≥ current + increment ladder (§8) | below-min rejected `below_min_increment` | vitest `auction-engine` + RPC |
| AUC-02 | Self-raise: current top bidder may raise above own price, no floor | allowed; equal/lower rejected | vitest + RPC |
| AUC-03 | Sealed: one bid per user; amounts hidden until close | 2nd bid rejected; others' amounts not returned by RLS | RPC + RLS test |
| AUC-04 | Dutch: price ticks down by decrement/tick to floor, never below | matches `dutchCurrentPrice` | vitest |
| AUC-05 | Anti-snipe: bid in last `window` extends `ends_at` by `extend_by` | extension applied once, serialized under lock | vitest + concurrent test |
| AUC-06 | Reserve: top bid below reserve → `ended_unsold`; at/above → sells | correct branch | SQL scenario |
| AUC-07 | No bids at close → `ended_unsold` (+ auto-relist if enabled) | correct | SQL scenario |
| AUC-08 | Tie-break deterministic: amount desc, placed_at asc | earliest equal bid wins | vitest + RPC |
| AUC-09 | Sixth-offer (1/6): admissible offer ≥ ⌈winning×7/6⌉ within 8-day window | `minSixthOffer` enforced | vitest + RPC |
| AUC-10 | Auctions actually close automatically | `tick_auctions` pg_cron active every minute | `list_cron_jobs()` |
| AUC-11 | `awarded` winner can complete purchase (final payment captures, lot leaves catalogue) | sale settles; no stuck-forever with paid balance | flow + SQL |
| AUC-12 | `final_payment_due_at` stamped on award → reminders/overdue fire | column set; `notify_final_payment_due` runs | SQL + notifications |
| AUC-13 | Owner cannot bid on own listing; cannot cancel once bids exist | blocked server-side | RPC + route |
| AUC-14 | State machine has no dead-end/stuck state for any path | every status has an exit or is terminal-by-design | SQL audit |

## 4. Money & Payments Integrity
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| PAY-01 | Listing fee math: free / fixed / percent resolve correctly, never negative | matches `resolveListingFee` | vitest `pricing` |
| PAY-02 | Deposit math: free window / fixed / percent; required flag correct | matches `resolveDeposit` | vitest |
| PAY-03 | Displayed amount == charged amount (deposit, buy-now, final) | identical on page + checkout + capture | flow + code |
| PAY-04 | Final payment = winner_amount − caution (no double-pay of deposit) | net correct; seller gross == winner_amount | vitest + SQL |
| PAY-05 | A captured payment can be created ONLY server-side | direct PostgREST `status:'captured'` → `payment_status_forbidden` | live curl (RLS+trigger) |
| PAY-06 | No second payment after capture (idempotency) | checkout short-circuits already-captured (user,auction,kind) | code + flow |
| PAY-07 | final_payment checkout gated to the actual winner | non-winner redirected, not charged | code + flow |
| PAY-08 | Seller earnings = captured buy_now/final + winner deposit; refunded/failed excluded | matches `seller_earnings` | SQL |
| PAY-09 | Commission applied at configured rate; balance never negative | `available = max(0, net − paid − pending)` | SQL |
| PAY-10 | Payout cannot be double-paid (two admins/tabs) | per-seller advisory lock + balance recheck under lock | RPC `admin_set_payout_status` + concurrent test |
| PAY-11 | Winner's caution not refundable on a settled sale | refund blocked `winner_caution_locked` | route test |
| PAY-12 | Deposit lifecycle: locked → released/refunded/forfeited; no double-count | timestamps consistent | SQL |
| PAY-13 | All fees/deposits remain admin-parametrable (never hardcoded) | routed through `lib/pricing` + `app_settings` | code review |
| PAY-14 | app_settings cache invalidates on admin save (no stale fees) | `revalidateTag(APP_SETTINGS_TAG)` on PUT | code + flow |

## 5. Security
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| SEC-01 | RLS enabled on every sensitive table (payments, bids, deposits, kyc, payouts, profiles, notifications, popups…) | all `enable row level security` | SQL `pg_policies` |
| SEC-02 | Cannot bid without active deposit + verified KYC | `place_bid` rejects | RPC test |
| SEC-03 | Cannot place a bid below min / on own listing / after close | rejected server-side | RPC test |
| SEC-04 | No IDOR: KYC docs, receipts, inspection reports private | non-owner/anon cannot read; signed URLs short-TTL | bucket/RLS test |
| SEC-05 | All `/api/admin/*` require admin (route guard + RLS) | non-admin → 401/403 | `requireAdmin` + curl |
| SEC-06 | Mutating routes are same-origin guarded (CSRF) | cross-origin POST → 403 | curl with foreign Origin |
| SEC-07 | KYC verification is admin-only; verified users blocked from resubmission (DB+mw+UI) | enforced at 3 layers | code + SQL |
| SEC-08 | Admin role check can't be bypassed via JWT vs profiles drift | `is_admin()` resolves via profiles.role | SQL |
| SEC-09 | Security headers present (CSP, HSTS, X-CTO, Referrer-Policy, Permissions-Policy) | all set | `curl -I` |
| SEC-10 | No secrets in client bundle / repo | only NEXT_PUBLIC_* client-side; `.dev.vars`/keys gitignored | grep build + git |
| SEC-11 | Rate limiting on abuse-prone endpoints (waitlist, auth, bid) | limits enforced | code + test |
| SEC-12 | Sealed-bid amounts never leak (incl. via realtime/anti-snipe timing) | masked; document timing leak decision | RLS + review |

## 6. Auth & KYC Flow
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| AUTH-01 | Signup (phone + email) creates profile with phone populated | `profiles.phone` set; phone-login lookup works | flow |
| AUTH-02 | Login by phone or email; bad credentials handled with FR error | clear toast, no crash | flow |
| AUTH-03 | Forgot/reset password round-trip works | magic link → set password → login | flow |
| AUTH-04 | KYC: start → id-front → id-back → selfie → submitted → admin verify → can bid | each gate guides, none traps | flow |
| AUTH-05 | Pending/rejected KYC users see a guided state, not a dead end | distinct gates | flow |
| AUTH-06 | Open-redirect safe on `?next=` | scheme-relative/`//` blocked | unit/flow |
| AUTH-07 | Existing-email signup doesn't leak account existence | enumeration-safe copy | flow |

## 7. Realtime & Live UX
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| RT-01 | New bid reflects on the auction within ~1 s for other viewers | realtime INSERT propagates | 2-client test |
| RT-02 | Price/status/countdown update without manual refresh | UPDATE channel drives it | manual |
| RT-03 | Notification bell updates within ~250 ms of a new notification | realtime + debounce | manual |
| RT-04 | Countdown accurate (no drift, handles ended state) | matches `secondsRemaining` | unit + visual |
| RT-05 | Realtime falls back to safety-net poll if a message drops | leaderboard reconciles | manual (disconnect) |

## 8. Accessibility (per main page, mobile + desktop)
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| A11Y-01 | Exactly one `<h1>` per page; logical heading order | yes | axe / DOM |
| A11Y-02 | All images have alt (decorative = empty alt) | yes | axe |
| A11Y-03 | Interactive elements are real buttons/links, keyboard-operable | tab order works | keyboard test |
| A11Y-04 | Modals: focus-trap, Escape, focus restore, `aria-modal`+labelledby | yes | `Modal.tsx` + manual |
| A11Y-05 | Toasts announced to screen readers | `aria-live` region | review |
| A11Y-06 | Tap targets ≥ 44×44 px on mobile (icon buttons noted if smaller) | yes | measure |
| A11Y-07 | Inputs ≥ 16 px (no iOS zoom-on-focus) | yes | measure |
| A11Y-08 | Color contrast ≥ 4.5:1 for text | yes | axe |
| A11Y-09 | `lang` + `dir` set correctly | `lang="fr" dir="ltr"` | view-source |

## 9. SEO & Discoverability
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| SEO-01 | `/robots.txt` allows public, disallows admin/account/kyc/payment/api | yes | curl |
| SEO-02 | `/sitemap.xml` lists static + every public listing, regenerates ≤1h | yes | curl |
| SEO-03 | Per-listing `generateMetadata`: title+price+location, description, OG image | rich card on share | curl meta tags |
| SEO-04 | Non-public listings are `noindex` | yes | meta |
| SEO-05 | Canonical URLs set; `metadataBase` resolves absolute OG URLs | yes | meta |
| SEO-06 | Catalogue + home have descriptive metadata | yes | meta |

## 10. i18n / Localization
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| I18N-01 | 100% French UI — no English strings leak (incl. eyebrows, status enums, admin) | none | grep + visual |
| I18N-02 | TND amounts formatted with locale grouping, no decimals | yes | `formatTND` + visual |
| I18N-03 | Status enums render French labels, not raw `snake_case` | yes | review |
| I18N-04 | Locale routing: `/` → `/fr`; legacy `/ar`,`/en` redirect to `/fr` | yes | curl |

## 11. Mobile & PWA
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| MOB-01 | Zero horizontal overflow at 360/375/390px on every main page | `scrollWidth==clientWidth` | eval |
| MOB-02 | Bottom tab bar + safe-area insets respected | yes | visual |
| MOB-03 | Installable PWA (manifest + service worker + icons) | yes | Lighthouse PWA |
| MOB-04 | Offline / network-loss shows graceful state + auto-recover | NetworkStatus + error boundary | airplane-mode test |
| MOB-05 | Admin console usable on mobile (drawer nav, no fixed-rail overflow) | yes | visual |

## 12. Resilience & Error Handling
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| RES-01 | Every route segment has error/not-found/loading boundary or inherits one | yes | file audit |
| RES-02 | Supabase unavailable → pages degrade (no white screen) | fallback renders | env-off test |
| RES-03 | Build-time data timeout doesn't fail the build | home data phase caught | build |
| RES-04 | Failed payment capture rolls back cleanly (no money recorded without effect) | `_on_payment_captured` fails loud | SQL |

## 13. Observability
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| OBS-01 | Server errors captured with context (path, digest, route) | `instrumentation.onRequestError` logs | trigger error |
| OBS-02 | Client crashes (window error / unhandled rejection / boundary) shipped to server sink | `/api/observability/client-error` 204 | smoke test |
| OBS-03 | Web vitals + traffic collected | Vercel Analytics + Speed Insights mounted | deploy |
| OBS-04 | Admin can see platform activity (page views / actions) | activity_log + admin page | manual |

## 14. Code Quality & CI
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| CQ-01 | `pnpm typecheck` clean | exit 0 | CI |
| CQ-02 | `pnpm lint` 0 errors | exit 0 | CI |
| CQ-03 | `pnpm test` all green | 100% pass | CI |
| CQ-04 | `pnpm build` clean | exit 0 | CI |
| CQ-05 | CI gates lint+typecheck+test+build on every PR to main | required checks | GitHub |
| CQ-06 | Critical money/security logic unit-tested (pricing, auction-engine, iban, sameOrigin, rejection) | covered | vitest |
| CQ-07 | `strict` TS; ≤ a handful of `: any`; no `@ts-ignore` in app code | yes | grep |
| CQ-08 | No non-handler exports from route files (Next constraint) | none | grep |

## 15. Database & Migrations
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| DB-01 | Local migrations == remote (no drift) | in sync | `supabase migration list` |
| DB-02 | Migrations idempotent / re-runnable (`if not exists`, drop-then-create) | yes | review |
| DB-03 | Hot paths are SQL RPCs with row locks, not app-side races | place_bid/payout/close locked | review |
| DB-04 | Indexes on hot filters (auction status, bids by auction, activity by type/date) | present | SQL |
| DB-05 | Background jobs scheduled (tick, ending-soon, final-payment-due, cleanups) | all active | `list_cron_jobs()` |

## 16. Admin Console (most sensitive surface)
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| ADM-01 | Property review: approve/reject with status guard (no re-notify/resurrect) | enforced | route test |
| ADM-02 | KYC review approve/reject is atomic (submission + profile in one txn) | `review_kyc` RPC | SQL |
| ADM-03 | Payment accept/reject captures correctly + notifies buyer | works | manual |
| ADM-04 | Manual (offline) payment records a captured payment + fires downstream | works | manual |
| ADM-05 | Payout lifecycle requested→processing→paid/rejected, double-pay-safe | locked RPC | manual + concurrent |
| ADM-06 | Deposit prepare/refund/forfeit; destructive actions confirmed | 2-step confirm on forfeit | manual |
| ADM-07 | Settings save updates fees/promos/deposit/anti-snipe + invalidates cache | takes effect immediately | manual |
| ADM-08 | Notifications broadcast/queue; filters work; bulk delete safe | works | manual |
| ADM-09 | Queues support claim/lock so two admins don't collide | claim works | manual |
| ADM-10 | Admin role demotion takes effect promptly | access revoked | manual |
| ADM-11 | Admin data-dense tables reflow/scroll on mobile (no clipped data) | yes | visual |

## 17. Cost & Efficiency Budgets
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| COST-01 | Vercel bytes/pageview (HTML+JS+CSS, JS amortized) | ≤ 100 KB | measured |
| COST-02 | Image bytes/pageview (above-fold) | ≤ 400 KB | network panel |
| COST-03 | Base infra cost at launch (≤1k DAU, ≤100 concurrent) | ≤ $50/mo | Vercel+Supabase billing |
| COST-04 | Per-user cost at ~10k DAU | ≤ $0.01/user/mo | billing ÷ users |
| COST-05 | No per-request DB read for admin-config (fees/deposit) on hot pages | cached | log |

## 18. Operational / Launch Readiness
| ID | Benchmark | Pass | Verify |
|----|-----------|------|--------|
| OPS-01 | Required prod env vars set (SERVICE_ROLE_KEY, CRON_SECRET, SUPABASE_URL/ANON, SITE_URL) | all present | deploy env |
| OPS-02 | CRON_SECRET set so cron HTTP routes fail-closed | yes | curl without key → 401 |
| OPS-03 | Supabase tier sized for expected concurrency (Pro+ for realtime headroom) | yes | plan |
| OPS-04 | Daily DB backups enabled | yes | Supabase |
| OPS-05 | Seeded admin account exists + reachable | yes | login |
| OPS-06 | `main` clean, in sync with origin, deployable | yes | git |
| OPS-07 | Rollback plan: previous deploy promotable in 1 click | yes | Vercel deployments |

---

### How to run a full benchmark pass
1. **Automated:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (CQ-*), then `autocannon` on cached + DB routes (SCALE-*), then Lighthouse on home/catalogue/auction (PERF-*, A11Y-*, SEO-*, MOB-03).
2. **DB/security:** run the SQL/RLS checks (SEC-*, AUC-*, PAY-*, DB-*) incl. the live forge-payment probe (PAY-05) and `list_cron_jobs()` (AUC-10, DB-05).
3. **Manual flows:** signup→KYC→deposit→bid→win→pay→payout, and every admin action (AUTH-*, ADM-*, RT-*).
4. Record pass/fail per ID; no money/security item (PAY-*, SEC-*, AUC-*) may ship failing.
