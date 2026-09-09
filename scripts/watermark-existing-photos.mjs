/**
 * Stamp the lockup into every listing photo published before
 * `src/lib/watermark.ts` existed.
 *
 * New uploads are stamped in the browser on their way to storage. The 29
 * photos already in the catalogue are not, and those are the ones that have
 * been public longest.
 *
 * WHY THIS TOUCHES FILES AND NOT A BUCKET. Unlike Mazed Auto, every
 * `listing_photos.storage_path` here is `/properties/<slug>/<n>.webp` — a file
 * committed to `public/`, served by Next, not an object in Supabase storage.
 * So the backfill rewrites files in the working tree and the originals are
 * recoverable with `git checkout` — which is also why there is no
 * copy-aside step: git already is one.
 *
 * IDEMPOTENCE. There is nothing in a stamped file that says so, and running
 * this twice would stamp the stamp. `scripts/watermarked-photos.json` records
 * what has been done, keyed by the strength it was done at, and is committed
 * alongside the images. Changing the strength means restoring the originals
 * (`git checkout <commit-before> -- public/properties`) and running again —
 * the ledger's `settings` line is what tells you the files on disk no longer
 * match the constants above.
 *
 * WHY THE ALPHA IS SCALED BY HAND. The browser draws the mark under
 * `ctx.globalAlpha`. The obvious equivalent here is sharp's
 * `composite({ opacity })` — which is a no-op in sharp 0.34.5: opacity 1, 0.5,
 * 0.3 and 0.1 over the same input all produce a byte-identical result. It
 * fails silently, so a backfill written the obvious way would have burnt a
 * fully opaque logo into every photo and nothing would have complained. The
 * alpha channel is multiplied directly instead, which is what globalAlpha does.
 *
 *   node scripts/watermark-existing-photos.mjs            # report only
 *   node scripts/watermark-existing-photos.mjs --commit   # do it
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MARK = path.join(ROOT, "public", "logo-watermark.png");
const LEDGER = path.join(ROOT, "scripts", "watermarked-photos.json");

// Must match src/lib/watermark.ts.
const MARK_HEIGHT_RATIO = 0.22;
const MAX_MARK_WIDTH_RATIO = 0.32;
const MIN_MARK_PX = 96;
const MARK_OPACITY = 0.15;

const COMMIT = process.argv.includes("--commit");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

let cache = null;
async function markAt(width) {
  if (cache?.width === width) return cache;

  const resized = await sharp(MARK).resize({ width }).ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(resized).raw().toBuffer({ resolveWithObject: true });

  const scaled = Buffer.from(data);
  for (let i = 3; i < scaled.length; i += 4) scaled[i] = Math.round(scaled[i] * MARK_OPACITY);
  const mark = await sharp(scaled, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  // The canvas shadow, under the same globalAlpha. It is what carries a white
  // wordmark over a photographed survey plan.
  const blur = Math.max(6, Math.round(width * 0.035));
  const shadowAlpha = await sharp(resized)
    .extractChannel(3)
    .blur(blur / 2)
    .linear(0.55 * MARK_OPACITY, 0)
    .toBuffer();
  const shadow = await sharp({
    create: { width: info.width, height: info.height, channels: 3, background: "#000" },
  })
    .joinChannel(shadowAlpha)
    .png()
    .toBuffer();

  cache = { mark, shadow, width: info.width, height: info.height };
  return cache;
}

/**
 * The mark's width, clamped so it always fits inside the photo.
 *
 * Driven off the photo's HEIGHT, like the browser path: the lockup is a
 * portrait 0.74:1, so sizing it on the width would give a landscape photo a
 * stamp 40% of its height and a portrait one a stamp barely a fifth.
 *
 * `MIN_MARK_PX` is a floor on legibility, not a promise that the photo is big
 * enough to hold it. The catalogue contains a 120x120 thumbnail; asking for a
 * 160px mark on it made sharp refuse the whole composite ("Image to composite
 * must have same dimensions or smaller") and the browser, which does not
 * refuse, would have branded it with a cropped fragment of a logo.
 */
async function fittedWidth(width, height) {
  const meta = await sharp(MARK).metadata();
  const aspect = meta.height / meta.width;               // h / w, > 1 here
  const h = Math.min(Math.max(MIN_MARK_PX, Math.round(height * MARK_HEIGHT_RATIO)), height);
  return Math.min(Math.round(h / aspect), Math.round(width * MAX_MARK_WIDTH_RATIO), width);
}

async function stamp(buf) {
  const meta = await sharp(buf).metadata();
  const markW = await fittedWidth(meta.width, meta.height);
  const { mark, shadow, height: markH } = await markAt(markW);
  return sharp(buf)
    .composite([
      {
        input: shadow,
        left: Math.round((meta.width - markW) / 2),
        top: Math.round((meta.height - markH) / 2) + Math.max(1, Math.round(markW * 0.006)),
      },
      {
        input: mark,
        left: Math.round((meta.width - markW) / 2),
        top: Math.round((meta.height - markH) / 2),
      },
    ])
    .webp({ quality: 90 })
    .toBuffer();
}

const res = await fetch(`${SB_URL}/rest/v1/listing_photos?select=id,storage_path&order=id`, {
  headers: H,
});
if (!res.ok) throw new Error(`listing_photos read failed: ${res.status} ${await res.text()}`);
const rows = await res.json();

const SETTINGS = `h${MARK_HEIGHT_RATIO}-o${MARK_OPACITY}-mazed`;
const saved = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { done: [] };
// A ledger written at a different strength describes files that have since
// been restored from git; it must not be read as "already done".
const ledger = saved.settings === SETTINGS ? saved : { done: [] };
const already = new Set(ledger.done);

// Several rows can point at the same file; stamp each file once.
const files = [...new Set(rows.map((r) => r.storage_path).filter(Boolean))];
const local = files.filter((p) => p.startsWith("/properties/"));
const other = files.filter((p) => !p.startsWith("/properties/"));
const todo = local.filter((p) => !already.has(p));

console.log(`${rows.length} rows -> ${files.length} distinct files`);
console.log(`  ${local.length} under public/properties, ${already.size} already stamped, ${todo.length} to do`);
if (other.length) console.log(`  ${other.length} NOT local — skipped, this script only rewrites files:`, other.slice(0, 3));
if (!COMMIT) console.log("DRY RUN — pass --commit to write.\n");

let done = 0;
let failed = 0;
for (const rel of todo) {
  const abs = path.join(ROOT, "public", rel.replace(/^\/+/, ""));
  try {
    if (!fs.existsSync(abs)) throw new Error("file missing on disk");
    const stamped = await stamp(fs.readFileSync(abs));
    if (COMMIT) {
      fs.writeFileSync(abs, stamped);
      ledger.done.push(rel);
    }
    done += 1;
    console.log(`  ${done}/${todo.length}  ${rel}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAILED ${rel}: ${err.message}`);
  }
}

if (COMMIT) {
  ledger.settings = SETTINGS;
  ledger.updatedAt = new Date().toISOString();
  fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(`\n${COMMIT ? "stamped" : "would stamp"} ${done}, failed ${failed}`);
