// drift-check — sync guard for the twin repos
//   "mazed land"     (real-estate auctions, Batta)
//   "mazed auto v2"  (car auctions, Mazed Auto)
//
// Both projects share one baseline: the auction/payment/KYC core must stay
// byte-identical, while a known set of files is ALLOWED to differ (domain
// skin: car vs land wording, branding, theme tokens). This script makes
// accidental drift visible instead of silent:
//
//   node scripts/drift-check.mjs              report drift since last accept
//   node scripts/drift-check.mjs --init       (re)create the baseline from the
//                                             current state of both repos
//   node scripts/drift-check.mjs --accept [path…]
//                                             bless the current differences —
//                                             all flagged ones, or only those
//                                             whose path contains a filter
//
// Every file pair gets a status in the baseline:
//   same       must stay byte-identical in both repos
//   skin       allowed to differ (domain wording / branding / theme) — but a
//              change on ONE side only is still flagged, so you never forget
//              to port a fix to the twin
//   auto-only / land-only   exists in one project on purpose
//
// The baseline lives OUTSIDE both repos (../mazed-twin-baseline.json) so one
// copy serves both. This script is committed to BOTH repos as a "same" file —
// if the two copies ever diverge, the check flags itself.
//
// Exit code: 0 = in sync, 1 = drift needs review (leak warnings never fail).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARENT = dirname(resolve(__dirname, ".."));
const AUTO = join(PARENT, "mazed auto v2");
const LAND = join(PARENT, "mazed land");
const BASELINE_PATH = join(PARENT, "mazed-twin-baseline.json");

for (const [label, p] of [["mazed auto v2", AUTO], ["mazed land", LAND]]) {
  if (!existsSync(p)) {
    console.error(`✖ Cannot find "${label}" at ${p} — both repos must sit side by side.`);
    process.exit(2);
  }
}

// What we compare. Everything that defines behaviour or shared content;
// build output, deps, logs and per-project planning docs are out of scope.
const SCAN_DIRS = ["src", "supabase", "tests", "messages", "scripts", ".github", "public"];
const ROOT_FILES = [
  "package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json",
  "vercel.json", "vitest.config.ts", "eslint.config.mjs", "postcss.config.mjs",
  ".env.example", ".gitignore",
];

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(p.slice(base.length + 1).replaceAll("\\", "/"));
  }
}

/** rel path -> sha1 of file bytes, for one repo root. */
function scanRepo(root) {
  const rels = [];
  for (const d of SCAN_DIRS) if (existsSync(join(root, d))) walk(join(root, d), root, rels);
  for (const f of ROOT_FILES) if (existsSync(join(root, f))) rels.push(f);
  const map = new Map();
  for (const rel of rels) {
    map.set(rel, createHash("sha1").update(readFileSync(join(root, rel))).digest("hex"));
  }
  return map;
}

function classify(a, l) {
  if (a && l) return a === l ? "same" : "skin";
  return a ? "auto-only" : "land-only";
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`✖ No baseline at ${BASELINE_PATH} — run with --init first.`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function saveBaseline(b) {
  b.updatedAt = new Date().toISOString();
  const sorted = Object.fromEntries(Object.entries(b.files).sort(([x], [y]) => x.localeCompare(y)));
  writeFileSync(BASELINE_PATH, JSON.stringify({ ...b, files: sorted }, null, 1) + "\n");
}

function buildEntry(a, l) {
  const e = { status: classify(a, l) };
  if (a) e.auto = a;
  if (l) e.land = l;
  return e;
}

/**
 * Compare current repo state against the baseline.
 * Returns { fixes, flags }:
 *  - fixes: harmless baseline updates applied automatically (a change that
 *    landed identically on both sides, a file deleted from both, churn in a
 *    project-only file, …)
 *  - flags: real drift a human must resolve (port the change to the twin,
 *    or bless it with --accept).
 */
function analyze(baseline, auto, land) {
  const fixes = [];
  const flags = [];
  const rels = new Set([...Object.keys(baseline.files), ...auto.keys(), ...land.keys()]);

  for (const rel of [...rels].sort()) {
    const b = baseline.files[rel];
    const a = auto.get(rel);
    const l = land.get(rel);

    if (!b) {
      if (a && l && a === l) fixes.push({ rel, note: "new file, identical in both → tracked as same" });
      else if (a && l) flags.push({ rel, kind: "new-differs", msg: "NEW file in both repos but contents differ" });
      else if (a) flags.push({ rel, kind: "new-auto", msg: "NEW file only in mazed auto v2" });
      else flags.push({ rel, kind: "new-land", msg: "NEW file only in mazed land" });
      continue;
    }
    if (!a && !l) { fixes.push({ rel, note: "deleted from both → untracked" }); continue; }

    if (b.status === "same") {
      if (a && l) {
        if (a === l) { if (a !== b.auto) fixes.push({ rel, note: "synced change on both sides" }); }
        else flags.push({ rel, kind: "broken-same", msg: "must-be-IDENTICAL file now differs between the repos" });
      } else {
        flags.push({ rel, kind: a ? "missing-land" : "missing-auto", msg: `deleted in ${a ? "mazed land" : "mazed auto v2"} only` });
      }
    } else if (b.status === "skin") {
      if (a && l) {
        const aCh = a !== b.auto, lCh = l !== b.land;
        if (!aCh && !lCh) continue;
        if (a === l) fixes.push({ rel, note: "skin file converged → now identical, tracked as same" });
        else if (aCh && lCh) flags.push({ rel, kind: "both-changed", msg: "changed on BOTH sides (allowed-to-differ file) — confirm the change was applied to both, then --accept" });
        else flags.push({ rel, kind: "one-sided", msg: `changed in ${aCh ? "mazed auto v2" : "mazed land"} ONLY — port it to the twin, or --accept if domain-specific` });
      } else {
        flags.push({ rel, kind: a ? "missing-land" : "missing-auto", msg: `deleted in ${a ? "mazed land" : "mazed auto v2"} only` });
      }
    } else if (b.status === "auto-only") {
      if (l) flags.push({ rel, kind: "appeared", msg: "was auto-only, now also exists in mazed land — --accept to track the new shape" });
      else if (a !== b.auto) fixes.push({ rel, note: "auto-only file changed (no twin to sync)" });
    } else if (b.status === "land-only") {
      if (a) flags.push({ rel, kind: "appeared", msg: "was land-only, now also exists in mazed auto v2 — --accept to track the new shape" });
      else if (l !== b.land) fixes.push({ rel, note: "land-only file changed (no twin to sync)" });
    }
  }
  return { fixes, flags };
}

function applyFixesAndAccepted(baseline, auto, land, rels) {
  for (const rel of rels) {
    const a = auto.get(rel);
    const l = land.get(rel);
    if (!a && !l) delete baseline.files[rel];
    else baseline.files[rel] = buildEntry(a, l);
  }
}

// ── Remnant/leak scan (warnings only — never fails the check). Catches the
// other project's domain wording or branding bleeding into this one.
const LEAK_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".md", ".sql", ".svg", ".html"]);
const LEAKS = [
  { root: AUTO, label: "mazed auto v2", re: /(batta\.tn|batta tunisia|immobili|appartement|apartment|\bvilla\b)/i },
  { root: LAND, label: "mazed land", re: /(mazed\.tn|mazed auto|automobile|\bsedan\b|\bvoiture\b|kilom[ée]trage)/i },
];

function leakScan() {
  const hits = [];
  for (const { root, label, re } of LEAKS) {
    const rels = [];
    for (const d of ["src", "messages"]) if (existsSync(join(root, d))) walk(join(root, d), root, rels);
    for (const rel of rels) {
      if (![...LEAK_EXT].some((e) => rel.endsWith(e))) continue;
      const lines = readFileSync(join(root, rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(re);
        if (m) hits.push(`  [${label}] ${rel}:${i + 1}  …${m[0]}…`);
      });
    }
  }
  return hits;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args[0] === "--init" ? "init" : args[0] === "--accept" ? "accept" : "check";

console.log("Scanning both repos…");
const auto = scanRepo(AUTO);
const land = scanRepo(LAND);

if (mode === "init") {
  const files = {};
  for (const rel of new Set([...auto.keys(), ...land.keys()])) {
    files[rel] = buildEntry(auto.get(rel), land.get(rel));
  }
  const counts = {};
  for (const e of Object.values(files)) counts[e.status] = (counts[e.status] ?? 0) + 1;
  saveBaseline({ createdAt: new Date().toISOString(), files });
  console.log(`✔ Baseline written to ${BASELINE_PATH}`);
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}`);
  process.exit(0);
}

const baseline = loadBaseline();
const { fixes, flags } = analyze(baseline, auto, land);

if (mode === "accept") {
  const filters = args.slice(1).map((f) => f.toLowerCase().replaceAll("\\", "/"));
  const accepted = flags.filter((f) => filters.length === 0 || filters.some((x) => f.rel.toLowerCase().includes(x)));
  applyFixesAndAccepted(baseline, auto, land, [...fixes.map((f) => f.rel), ...accepted.map((f) => f.rel)]);
  saveBaseline(baseline);
  for (const f of accepted) console.log(`  ✔ accepted  ${f.rel}`);
  console.log(`✔ ${accepted.length} difference(s) blessed into the baseline${filters.length ? " (filtered)" : ""}.`);
  const left = flags.length - accepted.length;
  if (left > 0) console.log(`  ${left} flagged file(s) NOT accepted — run a plain check to see them.`);
  process.exit(0);
}

// mode === "check"
if (fixes.length) {
  applyFixesAndAccepted(baseline, auto, land, fixes.map((f) => f.rel));
  saveBaseline(baseline);
  console.log(`\n✔ ${fixes.length} harmless update(s) absorbed into the baseline:`);
  for (const f of fixes) console.log(`    ${f.rel} — ${f.note}`);
}

if (flags.length) {
  console.log(`\n⚠ DRIFT — ${flags.length} file(s) need a decision:\n`);
  const order = ["broken-same", "one-sided", "both-changed", "missing-auto", "missing-land", "new-auto", "new-land", "new-differs", "appeared"];
  for (const kind of order) {
    for (const f of flags.filter((x) => x.kind === kind)) {
      console.log(`  ✖ ${f.rel}\n      ${f.msg}`);
    }
  }
  console.log("\n  Fix: apply the missing change to the twin repo, then re-run.");
  console.log("  Or, if the difference is intentional (domain-specific):");
  console.log("      node scripts/drift-check.mjs --accept <part-of-path …>");
} else {
  console.log("\n✔ No drift — both repos match the blessed baseline.");
}

const leaks = leakScan();
if (leaks.length) {
  console.log(`\nℹ ${leaks.length} wording-leak warning(s) (other project's domain words — review when convenient, never fails the check):`);
  for (const h of leaks.slice(0, 25)) console.log(h);
  if (leaks.length > 25) console.log(`  … and ${leaks.length - 25} more`);
}

process.exit(flags.length ? 1 : 0);
