// ============================================================================
// Export every KYC dossier, then (optionally) purge it.
//
//   node scripts/kyc-export-and-purge.mjs                 # export only
//   node scripts/kyc-export-and-purge.mjs --purge         # export, then delete
//
// WHY. `kyc_submissions` holds 50 dossiers — CIN photographs, selfies, selfie
// videos and financial proofs of 50 people. They were collected for one
// purpose: an auction bidder had to be identifiable before they could be held
// to a bid. Batta does not run auctions any more, and publishing or answering
// a fixed-price annonce requires no identity check.
//
// Holding government ID images for a flow that no longer exists is a liability
// that only grows: it can be breached, subpoenaed or mishandled, and there is
// no longer any product reason to have it. So it goes.
//
// EXPORT FIRST, ALWAYS. `--purge` refuses to run unless the export completed
// and every referenced object was downloaded, because the alternative is
// discovering afterwards that a file was missing and the row that named it is
// gone too. The export is a directory you keep outside the repo:
//
//   kyc-export-<date>/
//     submissions.json      every row, verbatim
//     files/<user>/<name>   every referenced object from the `kyc` bucket
//     MANIFEST.txt          what was exported, what was missing, and when
//
// The export contains identity documents. It is written to the working
// directory and is .gitignore'd; move it somewhere you control and do not
// commit it.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const PURGE = process.argv.includes("--purge");
const BUCKET = "kyc";
const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(`kyc-export-${stamp}`);

/** Columns that name an object in the `kyc` bucket. */
const FILE_COLUMNS = [
  "id_front_url",
  "id_back_url",
  "selfie_image_url",
  "selfie_video_url",
  "financial_proof_path",
];

/**
 * A stored value may be a bare object path or a full public URL, depending on
 * which upload path wrote it. Both have to resolve to a bucket-relative key.
 */
function toObjectPath(value) {
  if (!value || typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = v.indexOf(marker);
  if (i !== -1) return decodeURIComponent(v.slice(i + marker.length));
  const signed = `/object/sign/${BUCKET}/`;
  const j = v.indexOf(signed);
  if (j !== -1) return decodeURIComponent(v.slice(j + signed.length).split("?")[0]);
  if (v.startsWith("http")) return null;           // some other host — not ours
  return v.replace(new RegExp(`^${BUCKET}/`), "");
}

// ── 1. Export ───────────────────────────────────────────────────────────────
const { data: rows, error } = await sb.from("kyc_submissions").select("*");
if (error) {
  console.error("could not read kyc_submissions:", error.message);
  process.exit(1);
}
console.log(`${rows.length} dossier(s) to export.`);

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "submissions.json"), JSON.stringify(rows, null, 2));

const downloaded = [];
const missing = [];
/**
 * Rows written by `seed-admin-stress.mjs` name `mock/stress/cin-front.jpg` and
 * friends. Those objects were never uploaded — the seed invented the path and
 * stopped there — so "not found" is the expected answer, not a lost file, and
 * blocking the purge on them would block it forever.
 *
 * Tracked separately rather than filtered out silently: the count belongs in
 * the manifest, and the distinction between "a placeholder that never existed"
 * and "a real reference we could not fetch" is exactly what the purge guard
 * turns on.
 */
const placeholders = [];
const isPlaceholder = (p) => p.startsWith("mock/");

for (const row of rows) {
  for (const col of FILE_COLUMNS) {
    const objPath = toObjectPath(row[col]);
    if (!objPath) continue;
    const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(objPath);
    if (dlErr || !blob) {
      (isPlaceholder(objPath) ? placeholders : missing).push(
        `${row.id} ${col} ${objPath} — ${dlErr?.message ?? "empty"}`,
      );
      continue;
    }
    const dest = path.join(outDir, "files", objPath);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await blob.arrayBuffer()));
    downloaded.push(objPath);
  }
}

const manifest = [
  `KYC export — ${new Date().toISOString()}`,
  `project: ${url}`,
  ``,
  `dossiers exported : ${rows.length}`,
  `files downloaded  : ${downloaded.length}`,
  `seed placeholders : ${placeholders.length}  (mock/* paths that were never uploaded)`,
  `files MISSING     : ${missing.length}  (real references that could not be fetched)`,
  ``,
  `These are identity documents. Keep this directory somewhere you control.`,
  ...(missing.length ? ["", "MISSING (object named by a row but not in the bucket):", ...missing] : []),
  ...(placeholders.length
    ? ["", "SEED PLACEHOLDERS (expected; no file ever existed):", ...placeholders]
    : []),
].join("\n");
writeFileSync(path.join(outDir, "MANIFEST.txt"), manifest + "\n");

console.log(`\nexported to ${outDir}`);
console.log(`  submissions.json  ${rows.length} row(s)`);
console.log(`  files/            ${downloaded.length} object(s)`);
if (placeholders.length)
  console.log(`  seed placeholders ${placeholders.length} (mock/* — never uploaded, expected)`);
if (missing.length) console.log(`  MISSING           ${missing.length} object(s) — see MANIFEST.txt`);

if (!PURGE) {
  console.log("\nExport only. Re-run with --purge to delete the rows and empty the bucket.");
  process.exit(0);
}

// ── 2. Purge ────────────────────────────────────────────────────────────────
// The guard is not ceremony: a row naming a file we failed to download is the
// one case where deleting loses something the export does not have.
if (missing.length > 0) {
  console.error(
    `\nREFUSING TO PURGE: ${missing.length} referenced object(s) could not be downloaded.` +
      `\nDeleting now would destroy files the export does not contain. See MANIFEST.txt.`,
  );
  process.exit(1);
}
if (!existsSync(path.join(outDir, "submissions.json"))) {
  console.error("\nREFUSING TO PURGE: export file is missing.");
  process.exit(1);
}

console.log("\npurging…");

// Storage first. If this half fails we still hold the rows that name the
// objects, which is the recoverable order; the reverse is not.
let removed = 0;
const listAll = async (prefix) => {
  const out = [];
  const { data, error: lsErr } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (lsErr) throw new Error(`list ${prefix}: ${lsErr.message}`);
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A "folder" comes back with no id; recurse into it.
    if (entry.id == null) out.push(...(await listAll(full)));
    else out.push(full);
  }
  return out;
};

const objects = await listAll("");
for (let i = 0; i < objects.length; i += 100) {
  const batch = objects.slice(i, i + 100);
  const { error: rmErr } = await sb.storage.from(BUCKET).remove(batch);
  if (rmErr) {
    console.error(`  storage remove failed: ${rmErr.message}`);
    process.exit(1);
  }
  removed += batch.length;
}
console.log(`  removed ${removed} object(s) from the "${BUCKET}" bucket`);

const { error: delErr, count } = await sb
  .from("kyc_submissions")
  .delete({ count: "exact" })
  .not("id", "is", null);
if (delErr) {
  console.error(`  row delete failed: ${delErr.message}`);
  process.exit(1);
}
console.log(`  deleted ${count ?? "?"} row(s) from kyc_submissions`);
console.log("\nPurge complete. The export is the only remaining copy.");
