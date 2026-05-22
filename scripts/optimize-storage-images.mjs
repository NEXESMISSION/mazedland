// ============================================================================
// Re-compress every image already uploaded to Supabase Storage.
//
// Why: the in-app upload pipeline got tighter quality/maxEdge presets and
// EXIF-orientation handling; rows ingested before those changes are still
// 2-5x larger than they need to be. This script rewrites each image in
// place at the new presets so the catalogue's bandwidth follows.
//
// Strategy:
//   1. Walk each bucket (properties, kyc, property-documents,
//      inspector-credentials, inspection-reports).
//   2. For each image object, download it, decode with sharp (which
//      handles HEIC via libheif), resize so the long edge ≤ maxEdge,
//      and re-encode as AVIF (photo buckets) or WebP (document buckets).
//   3. Upload to the SAME storage path with upsert:true and the new
//      Content-Type. The path doesn't change, so property_photos.
//      storage_path references stay valid; URLs already in flight stay
//      valid; signed-URL flows aren't disturbed.
//   4. Skip when the existing object is already small + modern.
//   5. Skip non-image rows (PDFs in property-documents).
//
// Idempotent: a second run finds everything already optimized and exits
// quickly.
//
// Safety:
//   - Default mode is DRY-RUN. Pass --apply to actually rewrite bytes.
//   - --bucket=name limits to one bucket for staged rollouts.
//   - --limit=N caps the per-bucket work for spot-checking.
//   - Network failures are logged + skipped; the script never deletes.
//
// Usage:
//   node scripts/optimize-storage-images.mjs            # dry run
//   node scripts/optimize-storage-images.mjs --apply    # actually write
//   node scripts/optimize-storage-images.mjs --apply --bucket=properties
//   node scripts/optimize-storage-images.mjs --apply --limit=50
// ============================================================================

import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env.local without pulling in dotenv as a dependency.
function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^"|"$/g, "");
    }
  } catch { /* env file missing — rely on process env */ }
}
loadEnv();

const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has("--apply");
const BUCKET_FILTER = [...ARGS].find((a) => a.startsWith("--bucket="))?.split("=")[1] ?? null;
const LIMIT = Number(
  [...ARGS].find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0",
) || null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Per-bucket compression presets — mirror the client-side imageCompress
// settings so a freshly-uploaded image and a freshly-rewritten one land
// at the same byte count.
const PRESETS = {
  properties:             { maxEdge: 1600, format: "avif", quality: 60 },
  kyc:                    { maxEdge: 1600, format: "webp", quality: 82 },
  "property-documents":   { maxEdge: 1800, format: "webp", quality: 84 },
  "inspector-credentials":{ maxEdge: 1600, format: "webp", quality: 82 },
  "inspection-reports":   { maxEdge: 1800, format: "webp", quality: 84 },
};

const BUCKETS = BUCKET_FILTER ? [BUCKET_FILTER] : Object.keys(PRESETS);

const IS_IMAGE_RE = /\.(jpe?g|png|webp|gif|hei[cf]|avif|tiff?|bmp)$/i;
const SKIP_BELOW_BYTES = 120 * 1024;

// Recursively list every object in a bucket. Supabase's `list()` is
// non-recursive and capped at 1000 per call, so we walk folders ourselves.
async function* walkBucket(bucket, prefix = "") {
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.error(`  ! list error in ${bucket}/${prefix}: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) return;
    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders have null id + null metadata. Recurse.
      if (entry.id === null) {
        yield* walkBucket(bucket, fullPath);
      } else {
        yield { path: fullPath, size: entry.metadata?.size ?? 0, mime: entry.metadata?.mimetype ?? "" };
      }
    }
    if (data.length < 1000) return;
    offset += data.length;
  }
}

async function downloadObject(bucket, fullPath) {
  const { data, error } = await supabase.storage.from(bucket).download(fullPath);
  if (error) throw new Error(`download ${bucket}/${fullPath}: ${error.message}`);
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function reencode(buf, preset) {
  const img = sharp(buf, { failOn: "none" }).rotate(); // auto EXIF rotation
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  let pipeline = img;
  if (longEdge > preset.maxEdge) {
    pipeline = pipeline.resize({
      width:  meta.width  >= meta.height ? preset.maxEdge : null,
      height: meta.height >  meta.width  ? preset.maxEdge : null,
      withoutEnlargement: true,
      fit: "inside",
    });
  }
  if (preset.format === "avif") {
    pipeline = pipeline.avif({ quality: preset.quality, effort: 4 });
    return { buffer: await pipeline.toBuffer(), contentType: "image/avif" };
  } else {
    pipeline = pipeline.webp({ quality: preset.quality, effort: 4 });
    return { buffer: await pipeline.toBuffer(), contentType: "image/webp" };
  }
}

async function processBucket(bucket) {
  const preset = PRESETS[bucket];
  if (!preset) { console.log(`(skip ${bucket} — no preset)`); return; }
  console.log(`\n=== ${bucket} === (maxEdge=${preset.maxEdge} ${preset.format} q${preset.quality})`);

  let scanned = 0, optimized = 0, skipped = 0, failed = 0;
  let bytesBefore = 0, bytesAfter = 0;

  const targetMime = preset.format === "avif" ? "image/avif" : "image/webp";
  for await (const obj of walkBucket(bucket)) {
    if (LIMIT && scanned >= LIMIT) break;
    scanned++;
    if (!IS_IMAGE_RE.test(obj.path)) { skipped++; continue; }

    // Idempotency guard: skip when the object is ALREADY in the target
    // format. The previous version only checked the path extension —
    // after the first --apply run our /properties files are AVIF bytes
    // sitting at .jpg paths, and that check missed them, so a re-run
    // would re-encode (and lossy-degrade) every file. Reading the
    // stored Content-Type via list metadata catches them.
    if (obj.mime === targetMime) {
      skipped++;
      continue;
    }

    try {
      const original = await downloadObject(bucket, obj.path);
      const { buffer: out, contentType } = await reencode(original, preset);

      // Sometimes a re-encode is bigger than the source (already
      // optimized aggressively, or tiny PNG with palette). Keep the
      // smaller of the two — and skip if we wouldn't actually save bytes.
      if (out.length >= original.length) {
        skipped++;
        console.log(`  · ${obj.path}  ${kb(original.length)} → ${kb(out.length)}  [larger, skip]`);
        continue;
      }

      const savedPct = Math.round((1 - out.length / original.length) * 100);
      bytesBefore += original.length;
      bytesAfter  += out.length;
      console.log(
        `  ${APPLY ? "✓" : "·"} ${obj.path}  ${kb(original.length)} → ${kb(out.length)}  (-${savedPct}%)`,
      );

      if (APPLY) {
        // Upsert in place — path stays the same so all DB references and
        // already-signed URLs remain valid. Content-Type is updated so
        // the new bytes are served with the right MIME.
        const { error } = await supabase.storage
          .from(bucket)
          .upload(obj.path, out, {
            contentType,
            upsert: true,
            cacheControl: bucket === "properties" ? "31536000" : "3600",
          });
        if (error) throw new Error(`upload: ${error.message}`);
      }
      optimized++;
    } catch (e) {
      failed++;
      console.log(`  ! ${obj.path}  failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `--- ${bucket}: scanned=${scanned} optimized=${optimized} skipped=${skipped} failed=${failed}`,
  );
  if (bytesBefore) {
    const total = Math.round((1 - bytesAfter / bytesBefore) * 100);
    console.log(`    total: ${kb(bytesBefore)} → ${kb(bytesAfter)}  (-${total}%)`);
  }
}

function kb(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

(async () => {
  console.log(
    `mode=${APPLY ? "APPLY (writes)" : "DRY RUN (no writes — pass --apply)"}` +
      (BUCKET_FILTER ? ` bucket=${BUCKET_FILTER}` : "") +
      (LIMIT ? ` limit=${LIMIT}` : ""),
  );
  for (const b of BUCKETS) await processBucket(b);
  console.log("\ndone.");
})().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
