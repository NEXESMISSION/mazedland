#!/usr/bin/env node
// ============================================================================
// i18n key check — every translation key the code asks for must exist in
// messages/fr.json.
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
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*([^)]*)\)/g;
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const missing = [];
const referencedTop = new Set();
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");

  const bindings = [];
  for (const m of src.matchAll(BIND)) {
    const arg = m[2].trim();
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

if (missing.length) process.exit(1);
console.log("✓ every statically resolvable key exists");
