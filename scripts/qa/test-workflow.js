export const meta = {
  name: 'mazed-qa-wave',
  description: 'One wave of the Mazed Immo QA tour: test the given areas against the local production build, then verify each finding',
  phases: [
    { title: 'Test', detail: 'one agent per area, findings saved to disk as they go' },
    { title: 'Verify', detail: 'each finding reproduced by an independent agent; high ones also code-checked' },
  ],
}

// One wave of the tour: a finder agent per area, then every finding re-run by an
// independent verifier (critical and high ones also checked against the code).
// A regression area re-runs the saved findings of an earlier wave against a
// fixed build and reports what is STILL broken and what the fixes broke.
//
// Everything about the machine comes through `args`: the Workflow runtime has
// no filesystem, so this script cannot read scripts/qa/config.json itself. Build
// the args with  node scripts/qa/workflow-args.cjs test <area...>  (README.md).
//   areas     keys of the areas to test (see AREAS below), or "regress:<area>[+<area>…]" to re-run
//             the saved findings of those areas against a fixed build
//   qa        the work folder: each agent writes its scripts, logs and findings under <qa>/<area>/
//   lib       absolute path of qa-lib.cjs
//   code      the checkout the QA server was built from (read-only for the agents)
//   branch    the branch that checkout is on, named in the prompt (default "main")
//   base      the QA server (default http://localhost:3009)
//   model     the agents' model (default "sonnet")
//   findings  regression areas: the saved wave file (what summarize.cjs wrote) to re-run
//   fixNotes  regression areas, optional: what the fixes changed, so the agents know what to expect
//   known     optional: findings earlier waves already reported, one line each — not to be reported again
//   prefix    optional: key prefix of the regression areas (default "regress"; "regress2" for a second round)
const QA = args.qa
const LIB = args.lib
const CODE = args.code
const BRANCH = args.branch || 'main'
const BASE = args.base || 'http://localhost:3009'
const MODEL = args.model || 'sonnet'
const SAVED = args.findings || ''
const PREFIX = args.prefix || 'regress'
if (!QA || !LIB || !CODE || !Array.isArray(args.areas) || args.areas.length === 0) {
  throw new Error('args.qa, args.lib, args.code and args.areas are required — build them with: node scripts/qa/workflow-args.cjs test <area...>')
}

const KNOWN = args.known ? `
ALREADY REPORTED by earlier runs — do NOT report these again (mention them only if you find them worse than described):
${args.known}` : ''

const SHARED = `
You are testing MAZED IMMO (www.mazed.immo): a Tunisian real-estate classifieds site, Next.js 16 app router + Supabase, French (default, /fr) and Arabic (/ar, RTL). Sale and rent. Individuals publish 2 annonces for free (live at the same time); more needs Mazed Immo Pro (an "agence"/shop on a monthly plan paid by bank transfer / D17 receipt). Phone-only auth (OTP by SMS before signup). A console for admins at /{locale}/admin (full admins vs scoped members; "settings" and "equipe" sections are owner-only).

CODE under test (read-only for you): ${CODE}  (branch ${BRANCH}). Pages: src/app/[locale]/**/page.tsx. API: src/app/api/**/route.ts. Settings registry: src/lib/settings/registry.ts. Admin gate: src/lib/admin/{guard,session,sections}.ts. Migrations: supabase/migrations. Messages: messages/fr.json, messages/ar.json.
SERVER under test: a PRODUCTION build (next start) of that code at ${BASE}. Do NOT start any server, do NOT run next dev/build, do NOT use browser tools. Test over HTTP with the helper below. Do NOT edit any file in the repo. No git commands that change state.

HELPER LIBRARY — read it once, it is short: ${LIB}
  const qa = require("${LIB}");
  qa.makeUser({label, role:"individual"|"admin", scopes:[sections] for a scoped admin, language:"fr"|"ar"}) → a signed-in [TEST] account {id, phone, email, fullName, cookie}.
  qa.call(whoOrNull, method, path, jsonBody?, {locale, headers}) → {status, json, text, headers, location}. qa.get(who, path).
  qa.uploadPhoto(who) → storage path; qa.makeListing(who, overrides) → draft id via the real API (tracked). qa.categoryId().
  qa.svc = service-role supabase client (read anything; write ONLY rows you created). qa.db(async c => ...) = pg client. qa.track(kind,id) for rows you created another way ("shops","payments","requests","visits", or qa.track("extra",{table,id})).
  qa.P(ok, "message", extraOnFail) tallies a check; qa.report(). ALWAYS end with  finally { await qa.cleanup(); }.
Work in ${QA}/<area>/ (create it if it is missing). If it already holds scripts and *.log/*.out files from a run that was cut off, READ THEIR OUTPUT FIRST and reuse the scripts; do not redo what they already covered. Run scripts with node from that directory with the Bash timeout parameter (up to 600000). Keep output short: print ✓/✗ lines, grep HTML instead of printing it.
SAVE AS YOU GO: after each script, append your new findings to ${QA}/<area>/findings.json (a JSON array of finding objects in the result format below) and write ${QA}/<area>/progress.json ({passed, failed, notes}). If you are cut off, that file is what survives.
BE ECONOMICAL: this run has a tight token budget. Few, well-aimed scripts; no re-reading files; no long explorations. Aim to finish in about 40 tool calls.
${KNOWN}

HARD RULES (the database is the LIVE production database):
 - Create only [TEST]-tagged data (the helper does), act only on rows you created, never modify or delete real users, annonces, shops, payments, products, settings. NEVER call POST /api/admin/settings with values — GET or auth checks only. NEVER POST /api/admin/notifications/broadcast successfully — auth checks only. Never use admin bulk actions on real rows. Never touch files in the storage bucket "backups" except ones you created.
 - NEVER trigger an SMS or an e-mail: never call /api/auth/phone/send with a valid number (invalid → 400 is fine), never call /api/cron/* with the real CRON_SECRET (wrong key → 401 is the test), never flip sms prefs on real profiles. Signup end-to-end needs an SMS OTP: check validations only (403 phone_not_verified without a proof); accounts come from qa.makeUser.
 - AI: at most 2 real calls to /api/ai/* in your whole run.
 - The rate limiter is per IP and testers share localhost: a 429 on auth/contact routes under load is NOT a bug — space such calls, never loop on them.
 - Secrets: never print values from .env.local.

WHAT COUNTS AS A FINDING: something a real visitor, seller, buyer, agence or admin would hit. Bugs (wrong status, 500, wrong data, broken flow, dead link, wrong redirect), security (anonymous or wrong user reaching private data or acting on others' rows; scoped admin crossing sections; a mutating route without same-origin check), i18n (French on /ar or Arabic on /fr, raw keys like "publish.title", unreplaced {placeholders}, "undefined"/"NaN"/"null" in HTML, direction issues), validation gaps, data integrity, SEO, a11y basics, performance smells. Be concrete: file:line and exact request/response. Severity: critical = data leak / money / core flow blocked for everyone; high = a main flow broken for some; medium = misbehaves with a workaround; low = cosmetic/wording. Confidence 0–1. Do not pad; do not report what you could not verify as a bug — put it in notes with coverage (what you tested, what you could not and why).`

const FINDINGS = {
  type: 'object',
  required: ['area', 'checks', 'findings', 'notes'],
  properties: {
    area: { type: 'string' },
    checks: { type: 'object', required: ['passed', 'failed'], properties: { passed: { type: 'integer' }, failed: { type: 'integer' } } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'kind', 'where', 'repro', 'expected', 'actual', 'suggestedFix', 'confidence'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          kind: { type: 'string', enum: ['bug', 'security', 'ux', 'i18n', 'validation', 'data', 'perf', 'seo', 'a11y', 'content'] },
          where: { type: 'string' },
          repro: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          suggestedFix: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: ['refuted', 'couldTest', 'reason', 'severity', 'confidence'],
  properties: {
    refuted: { type: 'boolean' },
    couldTest: { type: 'boolean' },
    reason: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    fixOpinion: { type: 'string' },
    confidence: { type: 'number' },
  },
}

// A regression area: the saved findings of one or more areas of an earlier
// wave, re-run against the fixed build. `key` is also the work folder.
const REGRESS = (areas, key) => `
This build contains FIXES for findings an earlier wave of this tour reported. Read ${SAVED} — a JSON array of area objects, each with "findings" (or a flat array of findings, each carrying its "area"); take ONLY the findings of the areas ${JSON.stringify(areas)} (ignore their "votes"). For EACH of them re-run its "repro" against ${BASE} (one short script per 3–5 findings, in ${QA}/${key}/, own [TEST] rows, cleanup) and decide: FIXED (the "expected" behaviour, or an equivalent one, now happens), STILL (the "actual" behaviour is unchanged or only partly fixed), UNTESTABLE (say why in one line) or CONFIG (needs an environment secret the owner must add). Error codes may differ from the "expected" text as long as the behaviour is right (a 400/403/404/409 where there was a 500 or a silent success is FIXED).
Report in "findings" ONLY the STILL ones — title prefixed "STILL: " + the original title, what still happens, and the file:line you believe is responsible — and any NEW problem the fixes introduced (a route that now answers 500, a page that no longer renders, a flow that no longer works), prefixed "NEW: ". Put the tally in "notes": one line per original finding, "FIXED|STILL|UNTESTABLE|CONFIG — <title>". checks.passed = number FIXED, checks.failed = number STILL.${args.fixNotes ? `
Things to know about the fixes: ${args.fixNotes}` : ''}`

const AREAS = [
  { key: 'auth', title: 'Auth and account', brief: `
Pages: /login, /signup, /forgot-password, /reset-password, /account, /account/settings, /account/activity, /account/bids, /account/wins (legacy auction pages: 500? redirect? honest empty state?), fr and ar.
APIs: POST /api/auth/login-by-phone (good/bad credentials, unknown phone, malformed body; never loop), POST /api/auth/signup (without the phone proof → 403 phone_not_verified; invalid phone 400; weak password 400; cross-origin 403), POST /api/auth/phone/send ONLY with an invalid number (400), /api/auth/phone/verify with no code (400), /api/auth/reset-password without proof, /api/auth/signout, /api/account/profile (PATCH validation), /api/account/language, /api/account/sms-pref, /api/account/consents, /api/account/export (caller's data only?), /api/account/delete (a [TEST] account: what is left behind?), GET /api/notifications + mark read.
Gates: anonymous /fr/account* → login redirect with next=; one user cannot read another's data through these routes.` },
  { key: 'publish', title: 'Seller: publish form, drafts, photos, submit, moderation, my annonces, edit, renew, promote', brief: `
Pages: /annonces/nouvelle (fr+ar; ?draft=, ?edit=, ?deal=rent, ?forme=1), /account/listings, /account/listings/[id]/promote and /mise-en-avant, /account/payments, /payment/checkout?payment=, /payment/success, /payment/failed.
APIs: POST /api/annonces (validation: incomplete, bad_category, category_not_leaf, price, attributes bounds, max photos, phone format, rent facts only for rent; non-owner update → 403; published annonce through this route → 409), /api/annonces/photo-url, /api/annonces/[id]/submit (contact/attestation/photo/attribute required; first annonce → pending_review; banned words / phone in text → flags; 3rd live → 402 free_limit_reached; pending re-submit → 409), /api/annonces/[id]/status (withdraw, sold/rented, relist), /renew, /edit (0172 pending_edit), DELETE if it exists, /promo → payment → checkout, /api/payments/[id]/receipt (owner only, types, size), /cancel.
Flow end to end with [TEST] accounts: draft → submit → [TEST] admin approves via POST /api/admin/annonces/[id] {action:"approve"} → public → withdraw/sold → relist/renew → the free limit. Check the seller's notifications in the DB (kind, language).` },
  { key: 'buyer', title: 'Buyer side: favorites, compare, demandes and matches, visits, contact reveal, reports', brief: `
Pages: /watchlist, /comparer, /demandes/nouvelle, /account/requests, /account/visites (fr+ar).
APIs: /api/watchlist, /api/annonces/[id]/favorite, /api/requests (create/list/delete; requests_max_active; a demande matched when a fitting [TEST] annonce is approved → request_match notification; another user's demande → 404/403), /api/visites (create with slots; seller accepts/declines via /api/visites/[id]; buyer cancels; notifications; own annonce refused?), /api/annonces/[id]/contact (1–2 calls), /api/annonces/[id]/report (one per user; moderation_report_threshold distinct [TEST] reporters → hidden + admins notified), /api/popups/match|event, /api/pro/shops/[id]/suggest (anonymity of the demande's author).` },
  { key: 'console', title: 'Admin console: gates and scopes, moderation, sellers, agences, team, settings, notifications, backups', brief: `
Gates: for EVERY admin page and EVERY /api/admin/** route: anonymous → login redirect / 401; non-admin → 404 / 403; a scoped [TEST] admin with scopes ["annonces"] → only annonces (and home); full [TEST] admin → all. No phone numbers/names in HTML a non-admin receives.
Then each screen as a full [TEST] admin in fr and ar: /admin, /admin/annonces (+ approve/reject/edits/bulk on [TEST] rows only), /admin/vendeurs (+ search, detail; ban/unban only a [TEST] profile), /admin/demandes, /admin/agences (+ /api/admin/boutiques/[id] on a [TEST] shop), /admin/social, /admin/paiements, /admin/offres, /admin/resultats, /admin/publicites (+ /api/admin/ads create a [TEST] draft, update, delete), /admin/home (GET only), /admin/popups (+ create a [TEST] draft popup, delete), /admin/notifications (list, mark, bulk-delete of your rows only; broadcast auth only), /admin/legal-docs, /admin/catalogue (GET only), /admin/activity, /admin/equipe (+ add/remove a [TEST] member; audit entries), /admin/settings (GET only; each group tab), /admin/site, POST /api/admin/backup and /api/admin/backup/files (then remove only your files from bucket "backups"). Raw keys, "undefined", unlabelled actions (adminActions), broken links.` },
  { key: 'pro', title: 'Mazed Immo Pro: shops (agences), plans, members, projects, leads, reports, public agence pages', brief: `
Pages: /pro, /pro/creer, /pro/dashboard (every tab), /agences, /agences/[slug], /agences/[slug]/projets/[project], /factures/[id] (+ print).
APIs: POST /api/pro/shops (validation, limit, pending, admins notified), GET/PATCH /api/pro/shops/[id] (owner only), /members (add by phone, roles, remove), /documents, /subscribe (plan → payment → [TEST] admin captures via POST /api/admin/paiements/[id] → active period; plan change), /projects and /units (feature_projects, projects_need_plan, projects_max_units), /leads, /report, /suggest.
Flow: owner creates shop → plan → capture → [TEST] admin approves via POST /api/admin/boutiques/[id] → public agence page → owner publishes for the shop (shop_id; planCovers; a member who may not publish → 403) → invoice at /factures/[id]. Track shops/payments for cleanup.` },
  { key: 'payments', title: 'Payments and finance: checkout, receipts, admin decisions, invoices, credit notes, products', brief: `
Pages: /payment/checkout?payment=, /payment/success|failed, /account/payments, /factures/[id], /admin/paiements, /admin/offres.
APIs: /api/annonces/[id]/promo on a published [TEST] annonce, /api/payments/[id]/receipt (owner only, types, size → pending_review + admin_receipt_pending), /api/payments/[id]/cancel (only while pending), POST /api/admin/paiements/[id] as a [TEST] admin on [TEST] payments: capture activates what was bought (promo dates / subscription period / invoice with sequential number and VAT), reject notifies, wrong capture → credit note (0187), double capture refused, non-admin 403, scoped admin without "paiements" 403. /api/admin/products: GET; create ONE [TEST] product then delete it. Plans on /pro = active subscription products. Amounts in dinars.` },
  { key: 'notify', title: 'Notifications end to end: bell, kinds, links, languages (no sending)', brief: `
GET /api/notifications (unread count, list, pagination), mark one/all read; /admin/notifications. For each flow you can trigger with [TEST] accounts: listing_submitted, listing_approved/published, listing_rejected, request_match, visit_requested/answered, shop_approved, payment_accepted/rejected, listing_edit_applied/rejected, report → admin notification, shop created → admin_shop_pending. For each: row for the right user, kind in NOTIFICATION_KINDS (src/lib/notifications/target.ts) with fr+ar templates (messages notifications.<kind>[.variant]), payload vars fill every placeholder (render with src/lib/notifications/render.ts logic or compare to templates), link resolves to a page that answers 200 for that user, an "ar" recipient (qa.makeUser({language:"ar"})). SMS/e-mail composition only by code reading (src/lib/winsms toSmsText, email templates, sms-kinds, email-kinds).` },
  { key: 'data', title: 'Data layer: RLS and storage policies, DB functions and jobs (read-only), retention', brief: `
Introspect first, read-only: tables and their grants, policies, storage buckets and their policies, cron jobs. Integrity of the live rows (report, never repair): published listing_photos whose storage object is missing, invoices without a payment, approved shops without an active subscription, profiles with legacy roles, prices out of range. RLS as the ANON key: select profiles (phones!), payments, notifications, drafts, visit_requests, property_requests, shop_members, invoices, admin_audit, activity_log, app_settings; insert/update listings and profiles → must be refused/empty. RLS as a signed-in [TEST] user (Authorization: Bearer <session access_token>): read others' profiles/phones, payments, notifications, drafts? write others' rows? direct insert/update of listings must fail (0176). Storage: "properties" public; "receipts", "property-documents", "shop-documents", "backups" NOT readable anonymously (GET a real receipt's public URL → 400/403) nor writable. Functions: which public functions can anon/authenticated execute (information_schema.routine_privileges / has_function_privilege) — list the ones that should not be. Cron jobs: select jobname, command from cron.job (read-only) — do the secrets really travel as headers and not in the URL (verify with care, do not print the key). Do NOT call expire/remind functions with the service role.` },
  { key: 'cross', title: 'Cross-cutting: routing, same-origin, security headers, cron auth, error handling, assets, PWA, performance', brief: `
Routing: unknown paths under /fr and /ar answer a real 404 in the visitor's language (lang and dir attributes), encoded paths (/fr/%77atchlist) hit the same gates as the plain ones, redirects are real 3xx and not a 200 with a streamed redirect. Same-origin on every mutating API route (POST without Origin/Referer → 403 — sample each route group as a signed-in [TEST] user), security headers on HTML responses (X-Frame-Options / CSP frame-ancestors, X-Content-Type-Options, Referrer-Policy, HSTS — report what is missing), /api/cron/* with a wrong key → 401 (never the real key), /api/observability/client-error limits, /api/optimize-image only for the site's own images, /api/health content, malformed JSON body → 400 not 500 (sample routes), PWA: /manifest.webmanifest and /admin.webmanifest valid with icons that answer 200, /sw.js served, admin pages reference the admin manifest; performance: TTFB cold/warm of /fr, /fr/annonces, an annonce, /ar equivalents; Cache-Control on /_next/static and images; every <script src>/<link href>/<img src> of the home and an annonce page answers 200.` },
  { key: 'ai', title: 'AI features: one-sentence assistant, publish-by-talking chat, natural search', brief: `
At most 2 real calls to /api/ai/*. Test without spending: 401 anonymous, too_short 400, hourly caps (code), redaction of phone/e-mail before text leaves (src/lib/moderation/rules redactContacts; ONE real call with a phone number in the text → check what the ai_calls row and the response show), normalizeListingDraft bounds, /annonces/nouvelle/parler redirects (login; ?forme=1; feature_publish_chat; publish_chat_default), chat turn limits (24 turns / 800 chars), wantsToPublish, ai_calls cost accounting, aiAvailable gates, src/lib/search natural-language parsing via /annonces?q=... (Derja/French sentences; prices like "350 mille"; "S+2"; Arabic governorates), feature_ai_voice / feature_voice_search honoured in HTML.` },
  { key: 'public', title: 'Public site: home, catalogue, annonce page, compare, agences pages, pro landing, static pages, ads/popups APIs, internal links', brief: `
Pages (fr+ar): the home (rails content: home_rail_* settings honoured; ads rotation markup), /annonces (filters, sort, pagination, ?q=, unknown category or governorate), /annonces/[id] (a published annonce; a draft/pending/archived one and an unknown id for an anonymous visitor: status code, <title>, robots meta, og tags), /comparer with ids (compare_max), /agences and /agences/[slug] (approved only; pending hidden; projects pages), /pro landing plans vs products, /contact, /privacy, /terms, /sitemap.xml, /robots.txt, /favicon.ico. SEO basics on every page: one <title>, canonical and hreflang fr/ar, noindex on private pages. Internal <a href> sampling across these pages. APIs: /api/ads/[id]/view|click, /api/social/track, /api/optimize-image misuse.` },
]

function regression(spec) {
  const names = spec.slice('regress:'.length).split('+').map((s) => s.trim()).filter(Boolean)
  if (!names.length) throw new Error(`"${spec}": name at least one area, e.g. regress:auth or regress:auth+publish`)
  if (!SAVED) throw new Error(`"${spec}" needs args.findings — the saved wave file to re-run`)
  const key = `${PREFIX}-${names.join('-')}`
  return { key, title: `Regression: saved findings of ${names.join(', ')} on the fixed build`, noVerify: true, brief: REGRESS(names, key) }
}

function finderPrompt(a) {
  return `${SHARED}

YOUR AREA — ${a.title}
${a.brief}

Set area = "${a.key}" in your result. Finish with the structured result even if some checks are still missing — say what is missing in notes.`
}

function verifyPrompt(area, f, lens) {
  const base = `${SHARED}

A tester reported this finding in area "${area}":
${JSON.stringify(f, null, 2)}

`
  if (lens === 'repro') return base + `YOUR JOB (lens: reproduce + impact): REPRODUCE it against ${BASE} with the helper in ONE short script in ${QA}/verify/ (own [TEST] rows; clean up), judge the real impact and severity. refuted=true ONLY with evidence it is not a problem (works, by design, misread, test artefact, shared-IP rate limit). Could not test over HTTP → couldTest=false, judge from the description, do not refute. Aim for 10 tool calls.`
  return base + `YOUR JOB (lens: code): read the code at the place named (and around it) in ${CODE}; decide whether the diagnosis is right, whether the expected behaviour is what the code intends, and what the correct fix is (file:line). refuted=true ONLY if the code shows it is not a problem. No HTTP tests. Aim for 10 tool calls.`
}

const areas = args.areas.map((k) => {
  if (k.startsWith('regress:')) return regression(k)
  const a = AREAS.find((x) => x.key === k)
  if (!a) throw new Error(`unknown area "${k}" — one of ${AREAS.map((x) => x.key).join(', ')}, or regress:<area>`)
  return a
})
phase('Test')
log(`wave: ${areas.map((a) => a.key).join(', ')} (model ${MODEL})`)

const results = await pipeline(
  areas,
  (a) => agent(finderPrompt(a), { label: `test:${a.key}`, phase: 'Test', schema: FINDINGS, model: MODEL }),
  async (found, a) => {
    if (!found) return { area: a.key, checks: null, notes: 'finder failed', findings: [] }
    const findings = Array.isArray(found.findings) ? found.findings : []
    if (a.noVerify) {
      log(`${a.key}: ${found.checks?.passed ?? '?'} fixed / ${found.checks?.failed ?? '?'} still · ${findings.length} reported`)
      return { area: a.key, checks: found.checks, notes: found.notes, findings: findings.map((f) => ({ ...f, votes: [] })) }
    }
    log(`${a.key}: ${found.checks?.passed ?? '?'} ok / ${found.checks?.failed ?? '?'} failed · ${findings.length} findings → verify`)
    const verified = await parallel(findings.map((f, i) => () => {
      const lenses = ['repro']
      if (f.severity === 'critical' || f.severity === 'high') lenses.push('code')
      return parallel(lenses.map((lens) => () =>
        agent(verifyPrompt(a.key, f, lens), { label: `verify:${a.key}#${i + 1}:${lens}`, phase: 'Verify', schema: VERDICT, model: MODEL })))
        .then((votes) => ({ ...f, votes: votes.map((v, k) => ({ lens: lenses[k], ...(v || { refuted: false, couldTest: false, reason: 'verifier failed', severity: f.severity, confidence: 0 }) })) }))
    }))
    return { area: a.key, checks: found.checks, notes: found.notes, findings: verified.filter(Boolean) }
  },
)

const out = results.filter(Boolean)
let total = 0, kept = 0
for (const r of out) {
  for (const f of r.findings) {
    total++
    const judged = f.votes.filter((v) => v.couldTest)
    const refuters = judged.filter((v) => v.refuted)
    f.verdict = refuters.length === 0 ? 'confirmed' : refuters.length === judged.length ? 'refuted' : 'disputed'
    if (f.verdict !== 'refuted') kept++
  }
}
log(`wave done: ${total} findings, ${kept} confirmed or disputed`)
return out
