// make-groups2.cjs — the grouping used for wave 2b of the 2026-10-30 tour: two
// fix groups, and a MINE list of the findings done by hand in the main session
// (data-layer policies, next.config, the service worker) that no agent gets.
// Same contract as make-groups.cjs; kept as the second template because it
// shows the other shape a round takes — a few agents plus a by-hand list.
//   node scripts/qa/make-groups2.cjs <wave.json> [--out <dir>]
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config.cjs");

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const OUT = outAt >= 0 ? path.resolve(argv[outAt + 1]) : path.join(cfg.work, "fixes");
const input = argv.find((a, i) => !a.startsWith("--") && i !== (outAt >= 0 ? outAt + 1 : -1));
if (!input) { console.error("usage: node make-groups2.cjs <wave.json> [--out <dir>]"); process.exit(1); }
const wave = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
const flat = wave[0] && Array.isArray(wave[0].findings) ? wave.flatMap((r) => r.findings.map((f) => ({ area: r.area, ...f }))) : wave;
const all = flat.filter((f) => f.verdict !== "refuted");
const pick = (f) => ({ area: f.area, severity: f.severity, kind: f.kind, title: f.title, where: f.where, repro: f.repro, expected: f.expected, actual: f.actual, suggestedFix: f.suggestedFix, confidence: f.confidence });

const MINE = [
  /shop_id is writable on a draft/, /writing fee_payment_id on a draft/, /Promotion flags, view counters and expiry written/,
  /Console section scopes are not enforced/, /app_metadata admin claim/, /own phone number without an OTP/,
  /replace the image of a photo in place/, /cron secret is still in the URL/, /No e-mail has ever been sent/,
  /Unused buckets kyc/, /Internal and audit columns of published annonces/, /listing_reference_next/,
  /soft 404/i, /Service worker caches/, /X-Powered-By/, /CRON_SECRET \(and the \/api\/health/, /Brand images, icons, logo/,
  /Suspending an agence hides only its page/, /Plan descriptions in the database/, /malformed percent-escape/,
];
const GROUPS = {
  "search-ai": {
    migration: "0196",
    match: (f) => f.area === "ai",
    done: "Nothing of this group is done yet. The migration number is for the AI cost caps if you make check_rate_limit (0116) atomic (an advisory lock keyed on p_key, or an insert-then-count under the lock) — keep the function signature; do NOT apply it. Keep /api/ai calls to zero in your own tests: unit-test the parser (src/lib/search/understand.ts) and redactContacts (src/lib/moderation/rules.ts) with vitest instead.",
  },
  "web-public": {
    migration: "0197",
    match: (f) => (f.area === "cross" || f.area === "public" || /Abandoned uploads are never removed/.test(f.title)) && !MINE.some((m) => m.test(f.title)),
    done: "Done by hand on the branch, do NOT touch: next.config.ts (X-Powered-By, cache headers), public/sw.js, src/app/[locale]/[...rest]/page.tsx (the soft-404 regression), the suspend/reinstate of an agence's annonces, every data-layer policy or grant. For the « JSON body of literal null » finding use the helper src/lib/http/body.ts (jsonObject) that the payments fix introduced, in every listed route except the /api/ai/* ones (another agent has them). For the catalogue redirects served as 200: the page is streamed under src/app/[locale]/loading.tsx, so a redirect() thrown in the page body arrives after the shell; move the decision before the first byte (next.config.ts has htmlLimitedBots: /.*/, so generateMetadata runs before streaming — a redirect() or notFound() thrown there is a real 3xx/404) or into src/proxy.ts, and keep the behaviour identical. For the abandoned uploads (data, low): a cron route /api/cron/prune-uploads guarded like the other cron routes (src/lib/cron/auth.ts), deleting objects of the properties and receipts buckets older than 2 days that no listing_photos.storage_path / payments.receipt_urls / shop or ad row references, plus its cron.job in migration 0197 (look at how 0188 schedules jobs) — do NOT apply the migration, and do NOT run the route against the live buckets; unit-test the selection logic.",
  },
};
fs.mkdirSync(OUT, { recursive: true });
const used = new Set();
const groups = [];
for (const [slug, g] of Object.entries(GROUPS)) {
  const items = all.filter((f) => g.match(f));
  for (const f of items) used.add(f.title);
  const file = path.join(OUT, `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify({ slug, done: g.done, findings: items.map(pick) }, null, 1));
  groups.push({ slug, migration: g.migration, file: file.replace(/\\/g, "/"), count: items.length });
  console.log(`${slug}: ${items.length} findings`);
  for (const f of items) console.log(`   [${f.severity}] ${f.title.slice(0, 100)}`);
}
const mine = all.filter((f) => !used.has(f.title));
console.log(`\nby hand: ${mine.length}`);
for (const f of mine) console.log("  -", f.area, `[${f.severity}]`, f.title.slice(0, 100));
const groupsFile = path.join(OUT, `groups-${path.basename(input, ".json")}.json`);
fs.writeFileSync(groupsFile, JSON.stringify({ groups }, null, 1));
console.log(`groups file: ${groupsFile}`);
