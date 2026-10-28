/**
 * A copy of every stored file — photos, receipts, documents — on this machine.
 *
 * The other half of scripts/backup-db.mjs: the database (and Supabase's own
 * daily backup) only says where each file is. This downloads every file of
 * every Storage bucket into backups/storage_<date>/<bucket>/<path>, with a
 * manifest of what was copied and what could not be. The `backups` bucket
 * (the console's own backup files) is left out.
 *
 * With a previous copy given, files already there with the same size are
 * copied from it instead of downloaded again:
 *
 *   node scripts/backup-storage.mjs
 *   node scripts/backup-storage.mjs --since backups/storage_2026-10-28-20-30
 *
 * The files hold personal data (receipts, identity documents): backups/ is
 * ignored by git, and the folder should stay on this machine.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}
const sinceArg = process.argv.indexOf("--since");
const since = sinceArg > 0 ? path.resolve(ROOT, process.argv[sinceArg + 1]) : null;

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const dir = path.join(ROOT, "backups", `storage_${stamp}`);

/** Every file of a bucket, folder by folder (Storage lists one level at a time). */
async function walk(bucket, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const e of data ?? []) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await walk(bucket, p)));
      else if (!e.name.endsWith(".emptyFolderPlaceholder")) out.push({ bucket, path: p, size: Number(e.metadata?.size ?? 0) });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

const { data: buckets, error } = await db.storage.listBuckets();
if (error) {
  console.error(error.message);
  process.exit(1);
}

const items = [];
for (const b of buckets) if (b.id !== "backups") items.push(...(await walk(b.id)));

const manifest = { takenAt: new Date().toISOString(), buckets: {}, files: 0, bytes: 0, reused: 0, missing: [] };
let i = 0;
async function next() {
  while (i < items.length) {
    const it = items[i++];
    const to = path.join(dir, it.bucket, ...it.path.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const old = since ? path.join(since, it.bucket, ...it.path.split("/")) : null;
    if (old && fs.existsSync(old) && fs.statSync(old).size === it.size) {
      fs.copyFileSync(old, to);
      manifest.reused++;
    } else {
      const { data, error: e } = await db.storage.from(it.bucket).download(it.path);
      if (e || !data) {
        manifest.missing.push(`${it.bucket}/${it.path}`);
        continue;
      }
      fs.writeFileSync(to, Buffer.from(await data.arrayBuffer()));
    }
    manifest.files++;
    manifest.bytes += it.size;
    manifest.buckets[it.bucket] = (manifest.buckets[it.bucket] ?? 0) + 1;
  }
}
await Promise.all(Array.from({ length: 8 }, next));

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(
  `storage backup: ${manifest.files} files, ${(manifest.bytes / 1048576).toFixed(1)} MB` +
    (manifest.reused ? ` (${manifest.reused} reused)` : "") +
    (manifest.missing.length ? `, ${manifest.missing.length} could not be downloaded` : "") +
    ` → ${path.relative(ROOT, dir)}`,
);
