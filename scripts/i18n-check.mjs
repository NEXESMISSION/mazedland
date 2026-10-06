#!/usr/bin/env node
// ============================================================================
// i18n key check — every translation key the code asks for must exist in
// messages/fr.json, and messages/ar.json must carry exactly the same keys with
// the same placeholders ({count}, {name}…), so no Arabic page falls back to a
// key path or loses a value.
//
// next-intl does not fail a build over a missing key. In production it logs and
// renders the KEY PATH instead — "home.heroBidCta" in the middle of a page — a
// string no visitor should ever read, and nothing surfaces it until someone
// does. This is the gate that would have.
//
// Static analysis over the ways this codebase binds a translator:
//   const t = useTranslations("ns")                    (client components)
//   const t = await getTranslations("ns")              (server components)
//   const t = await getTranslations({ locale, namespace: "ns" })
//   const t = useTranslations()  /  getTranslations()  (root)
// and the calls made through the nearest preceding binding of that name:
//   t("key")   t.rich("key")   t.markup("key")   t.raw("key")
// A key built at runtime — t(`property.types.${k}`) — is checked as a PREFIX:
// something under "property.types." must exist. A key passed in a variable
// cannot be resolved statically and is not checked.
//
//   node scripts/i18n-check.mjs            exit 1 on any missing key
//   node scripts/i18n-check.mjs --unused   also list top-level namespaces
//                                          that nothing references statically
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const messages = JSON.parse(readFileSync(join(ROOT, "messages", "fr.json"), "utf8"));

const leaves = new Set();
const branches = new Set();
(function walk(node, path) {
  for (const [k, v] of Object.entries(node)) {
    const full = path ? `${path}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      branches.add(full);
      walk(v, full);
    } else {
      leaves.add(full);
    }
  }
})(messages, "");
const allKeys = [...leaves, ...branches];

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
  }
})(join(ROOT, "src"));

const BIND =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations|apiTranslator)\(\s*([^)]*)\)/g;
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const missing = [];
const referencedTop = new Set();
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");

  const bindings = [];
  for (const m of src.matchAll(BIND)) {
    // apiTranslator(req, "ns") — drop the request argument.
    const arg = m[2].trim().replace(/^[A-Za-z_$][\w$]*\s*,\s*/, "");
    const direct = arg.match(/^["'`]([^"'`]*)["'`]$/);
    const inObj = arg.match(/namespace\s*:\s*["'`]([^"'`]*)["'`]/);
    const ns = direct ? direct[1] : inObj ? inObj[1] : "";
    bindings.push({ name: m[1], ns, idx: m.index });
    if (ns) referencedTop.add(ns.split(".")[0]);
  }
  if (bindings.length === 0) continue;

  for (const name of new Set(bindings.map((b) => b.name))) {
    const call = new RegExp(
      `(?<![\\w$.])${escapeRe(name)}(?:\\.(?:rich|markup|raw))?\\(\\s*(["'\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`,
      "g",
    );
    for (const c of src.matchAll(call)) {
      const binding = bindings.filter((b) => b.name === name && b.idx < c.index).pop();
      if (!binding) continue;

      const quote = c[1];
      const raw = c[2];
      const dynamicAt = quote === "`" ? raw.indexOf("${") : -1;
      const keyPart = dynamicAt >= 0 ? raw.slice(0, dynamicAt) : raw;
      const full = binding.ns ? (keyPart ? `${binding.ns}.${keyPart}` : `${binding.ns}.`) : keyPart;
      checked++;
      if (full) referencedTop.add(full.split(".")[0]);

      if (dynamicAt >= 0) {
        if (!full) continue; // wholly dynamic key: nothing to check statically
        if (!allKeys.some((k) => k.startsWith(full))) {
          missing.push({ file, line: lineOf(src, c.index), key: `${full}…` });
        }
      } else if (!leaves.has(full) && !branches.has(full)) {
        missing.push({ file, line: lineOf(src, c.index), key: full });
      }
    }
  }
}

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");
console.log(`i18n-check: ${checked} translation calls checked across ${files.length} source files`);

if (missing.length) {
  console.log(`\n✗ ${missing.length} key(s) not found in messages/fr.json:`);
  for (const m of missing) console.log(`  ${rel(m.file)}:${m.line}  ${m.key}`);
}

if (process.argv.includes("--unused")) {
  const unused = Object.keys(messages).filter((k) => !referencedTop.has(k));
  console.log(
    `\nTop-level namespaces with no static reference (${unused.length}): ${unused.join(", ") || "none"}`,
  );
}

// ── fr ⇄ ar parity ─────────────────────────────────────────────────────────
// Placeholder names a message uses: "{count, plural, …}" → count, "{name}" →
// name. A small ICU walker rather than a regex: a brace after a plural/select
// selector ("one {Annonce}", "sale {Vente}") opens a branch body, which can only
// be told from an argument by where it sits.
function argsOf(msg) {
  const s = String(msg);
  const args = new Set();
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const word = () => { const m = /^[^\s,{}]+/.exec(s.slice(i)); i += m ? m[0].length : 0; return m ? m[0] : ""; };
  // Text until the closing brace of the current body (or the end).
  const text = () => {
    while (i < s.length) {
      if (s[i] === "'" && s[i + 1] === "'") { i += 2; continue; }
      if (s[i] === "'" && /[{}#]/.test(s[i + 1] ?? "")) { const end = s.indexOf("'", i + 1); i = end < 0 ? s.length : end + 1; continue; }
      if (s[i] === "{") { i++; argument(); continue; }
      if (s[i] === "}") return;
      i++;
    }
  };
  const argument = () => {
    ws();
    const name = word();
    ws();
    if (/^[A-Za-z_]\w*$/.test(name)) args.add(name);
    if (s[i] === "}") { i++; return; }
    if (s[i] !== ",") { text(); i++; return; } // malformed: skip to the brace
    i++;
    ws();
    const type = word();
    ws();
    if (["plural", "select", "selectordinal"].includes(type)) {
      if (s[i] === ",") i++;
      for (;;) {
        ws();
        if (i >= s.length) return;
        if (s[i] === "}") { i++; return; }
        word(); // selector, or offset:n
        ws();
        if (s[i] === "{") { i++; text(); i++; }
      }
    }
    // number / date / time with an optional style: skip to the closing brace.
    let depth = 1;
    while (i < s.length && depth) { if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; }
  };
  text();
  return args;
}
const flatten = (node, path = "", out = new Map()) => {
  for (const [k, v] of Object.entries(node)) {
    const full = path ? `${path}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, full, out);
    else out.set(full, v);
  }
  return out;
};
const frFlat = flatten(messages);
const arFlat = flatten(JSON.parse(readFileSync(join(ROOT, "messages", "ar.json"), "utf8")));
const notInAr = [...frFlat.keys()].filter((k) => !arFlat.has(k));
const notInFr = [...arFlat.keys()].filter((k) => !frFlat.has(k));
const argDrift = [...frFlat.keys()]
  .filter((k) => arFlat.has(k))
  .filter((k) => {
    const a = argsOf(frFlat.get(k));
    const b = argsOf(arFlat.get(k));
    return a.size !== b.size || [...a].some((x) => !b.has(x));
  });
const emptyAr = [...arFlat.entries()]
  .filter(([, v]) => typeof v === "string" && v.trim() === "")
  .map(([k]) => k);

const list = (keys) => keys.map((k) => `  ${k}`).join("\n");
if (notInAr.length) console.log(`\n✗ ${notInAr.length} key(s) missing from messages/ar.json:\n${list(notInAr)}`);
if (notInFr.length) console.log(`\n✗ ${notInFr.length} key(s) in messages/ar.json but not fr.json:\n${list(notInFr)}`);
if (argDrift.length) console.log(`\n✗ ${argDrift.length} message(s) whose placeholders differ between fr and ar:\n${list(argDrift)}`);
if (emptyAr.length) console.log(`\n✗ ${emptyAr.length} empty Arabic message(s):\n${list(emptyAr)}`);

const parityProblems = notInAr.length + notInFr.length + argDrift.length + emptyAr.length;
if (missing.length || parityProblems) process.exit(1);
console.log("✓ every statically resolvable key exists");
console.log(`✓ fr and ar carry the same ${frFlat.size} messages with the same placeholders`);
