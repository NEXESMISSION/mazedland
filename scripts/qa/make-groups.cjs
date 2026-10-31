// make-groups.cjs — cut the confirmed findings of a wave into fix groups: one
// JSON file per group (what its fix agent reads) and a groups file (what the
// fix workflow takes as args.groups, through workflow-args.cjs).
//
// Grouping is a judgment call made once per wave. GROUPS below is the table
// used for wave 2a of the 2026-10-30 tour, kept as the template: for a new
// round replace its entries — slug, the migration number reserved for the
// group (so two agents never pick the same one), which findings it takes, and
// what is already done on the branch so the agent does not redo it. Keep the
// groups disjoint: two agents given the same finding both create the same
// helper file.
//   node scripts/qa/make-groups.cjs <wave.json> [--out <dir>]
// <wave.json> is what summarize.cjs saved (an array of area results, or a flat
// array of findings each carrying its area). Files go to <workDir>/fixes
// (config.json) unless --out says otherwise; the groups file is named after
// the wave file (groups-<wave>.json).
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config.cjs");

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const OUT = outAt >= 0 ? path.resolve(argv[outAt + 1]) : path.join(cfg.work, "fixes");
const input = argv.find((a, i) => !a.startsWith("--") && i !== (outAt >= 0 ? outAt + 1 : -1));
if (!input) { console.error("usage: node make-groups.cjs <wave.json> [--out <dir>]"); process.exit(1); }
const wave = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
const flat = wave[0] && Array.isArray(wave[0].findings) ? wave.flatMap((r) => r.findings.map((f) => ({ area: r.area, ...f }))) : wave;
const all = flat.filter((f) => f.verdict !== "refuted");
const pick = (f) => ({ area: f.area, severity: f.severity, kind: f.kind, title: f.title, where: f.where, repro: f.repro, expected: f.expected, actual: f.actual, suggestedFix: f.suggestedFix, confidence: f.confidence });

const GROUPS = {
  "payments-console": {
    migration: "0192",
    match: (f) => f.area === "payments" || /Accepting a plan receipt marks/.test(f.title) || /payment the seller cancelled is still worded/.test(f.title),
    done: "Already done on the branch (do NOT redo): migration 0191 dropped the payments_self_insert policy (a user can no longer write a payment row); unique partial indexes now exist: payments_one_pending_subscription (user_id where status='pending' and kind='subscription') and payments_one_pending_promo ((metadata->>'listing_id') where status='pending' and kind='promo') — map their 23505 to a 409 in the promo and subscribe routes. The accept route must still recompute/verify the amount against the product (metadata.list_price or products) and check metadata.shop_id / listing_id belong to payments.user_id.",
  },
  "pro-agences": {
    migration: "0193",
    match: (f) => f.area === "pro" && !/Accepting a plan receipt marks/.test(f.title) && !/plan is full is told/.test(f.title),
    done: "Already done on the branch (do NOT redo): the agence-plan quota is now counted under a lock by claim_listing_place (0191) and the submit/relist/renew routes answer 402 plan_full with its own message (publishApi.planFull); the shop-documents and property-documents buckets now accept only images/PDF up to 10 MB (0191); a unique partial index shops_one_live_per_owner (owner_id where status in pending/approved/suspended) exists — map its 23505 to a 409 in POST /api/pro/shops; payments_one_pending_subscription exists — map 23505 to 409 in the subscribe route.",
  },
  "notifications": {
    migration: "0194",
    match: (f) => f.area === "notify" && !/rewrite every column/.test(f.title) && !/Scoped team members receive/.test(f.title),
    done: "Already done on the branch (do NOT redo): 0191 restricted a person's UPDATE on public.notifications to the read_at column, and _notify_admins() now notifies only the admins whose admin_scopes cover the kind's section (full admins = scopes null). For « Arabic broadcasts » keep the change small: if a per-language title/body needs a large composer rewrite, do the API part only and say so.",
  },
  "publish-buyer-residuals": {
    migration: "0195",
    match: (f) => (f.area === "regress-publish" || f.area === "regress-buyer" || f.area === "regress-auth") && !/plan's quota is still checked/.test(f.title) && !/payment the seller cancelled is still worded/.test(f.title) && !/visit request|visit requests/i.test(f.title) && !/Alert requests \(Mes demandes\)/.test(f.title) && !/POST \/api\/account\/delete answers 500/.test(f.title),
    done: "Already done on the branch (do NOT redo): account deletion now scrubs visit requests, leads and every demande's note (0191); the plan quota race; the popup form's fields have names. The receipts existence check lives in src/lib/listings/storage.ts (objectExists/missingPhotos): extend it, do not fork it.",
  },
  "console-residuals": {
    migration: "0196",
    match: (f) => f.area === "regress-console",
    done: "Already done on the branch (do NOT redo): the popup form's localised title/body fields have aria-labels (src/app/[locale]/admin/popups/PopupForm.tsx). Also fix, from the regression notes: src/app/api/admin/popups/route.ts and popups/[id]/route.ts use a LOCAL requireAdmin that ignores profiles.banned_at — make them use the shared guard (src/lib/admin/guard.ts requireAdmin(req, \"popups\")) or check banned_at the same way.",
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
  groups.push({ slug, migration: g.migration, file: file.replace(/\\/g, "/"), count: items.length, titles: items.map((f) => `[${f.severity}] ${f.title.slice(0, 90)}`) });
  console.log(`${slug}: ${items.length} findings → ${file}`);
}
const left = all.filter((f) => !used.has(f.title));
console.log(`not grouped: ${left.length}`);
for (const f of left) console.log("  -", f.area, f.title.slice(0, 100));
const groupsFile = path.join(OUT, `groups-${path.basename(input, ".json")}.json`);
fs.writeFileSync(groupsFile, JSON.stringify({ groups }, null, 1));
console.log(`groups file: ${groupsFile}`);
