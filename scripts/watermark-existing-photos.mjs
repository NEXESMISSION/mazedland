/**
 * Stamp the gold logo, small, in the top-right corner of every catalogue
 * photo — the same mark `src/lib/watermark.ts` puts on new uploads.
 *
 * 2026-10-24: the mark moved from a faint white lockup in the middle of the
 * photo to the gold logo in the corner (see watermark.ts for why). The files
 * were restored from the commit before the first stamp (f07ea03^) and
 * stamped once from those originals.
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
// logo.png with its faint alpha haze cleared — see MARK_SRC in watermark.ts.
const MARK = path.join(ROOT, "public", "logo-stamp.png");
const LEDGER = path.join(ROOT, "scripts", "watermarked-photos.json");

// Must match src/lib/watermark.ts.
const MARK_HEIGHT_RATIO = 0.13;
const MAX_MARK_WIDTH_RATIO = 0.16;
const MIN_MARK_PX = 48;
const MARGIN_TOP_RATIO = 0.04;
const MARGIN_RIGHT_RATIO = 0.08;
const MARK_OPACITY = 0.92;

const COMMIT = process.argv.includes("--commit");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

let cache = null;
/**
 * The logo at this width, under MARK_OPACITY, and its soft shadow on a canvas
 * padded so the blur is not clipped at the logo's edges.
 */
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

  // The canvas shadow: rgba(0,0,0,0.45), blur 6% of the width, under the
  // same globalAlpha. It lifts the gold off a white wall or a bright sky.
  const blur = Math.max(4, Math.round(width * 0.06));
  const pad = blur * 2;
  // Built from raw bytes: the logo's own alpha, padded, blurred as one
  // channel, then laid under black. (Letting sharp pad and join channels
  // gave an opaque black box.)
  const pw = info.width + 2 * pad;
  const ph = info.height + 2 * pad;
  const padded = Buffer.alloc(pw * ph);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      padded[(y + pad) * pw + (x + pad)] = data[(y * info.width + x) * 4 + 3];
    }
  }
  // One channel out, explicitly: sharp widens a blurred single channel to
  // three, and reading that as one stripes the shadow across the logo's box.
  const blurred = await sharp(padded, { raw: { width: pw, height: ph, channels: 1 } })
    .blur(blur / 2)
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (blurred.length !== pw * ph) throw new Error(`shadow: expected one channel, got ${blurred.length / (pw * ph)}`);
  const rgba = Buffer.alloc(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) rgba[i * 4 + 3] = Math.round(blurred[i] * 0.45 * MARK_OPACITY);
  const shadow = await sharp(rgba, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer();

  cache = { mark, shadow, pad, offset: Math.max(1, Math.round(width * 0.015)), width: info.width, height: info.height };
  return cache;
}

/** Where the logo goes and how big — the same box as markBox() in watermark.ts. */
async function markBox(width, height) {
  const meta = await sharp(MARK).metadata();
  const aspect = meta.height / meta.width;
  let h = Math.min(Math.max(MIN_MARK_PX, Math.round(height * MARK_HEIGHT_RATIO)), Math.round(height * 0.5));
  let w = Math.round(h / aspect);
  const maxW = Math.round(width * MAX_MARK_WIDTH_RATIO);
  if (w > maxW) {
    w = maxW;
    h = Math.round(w * aspect);
  }
  return { x: width - w - Math.round(width * MARGIN_RIGHT_RATIO), y: Math.round(height * MARGIN_TOP_RATIO), w };
}

async function stamp(buf) {
  const meta = await sharp(buf).metadata();
  const box = await markBox(meta.width, meta.height);
  const { mark, shadow, pad, offset } = await markAt(box.w);
  const layers = [];
  // The shadow only where it fits whole; sharp refuses an overlay that does not.
  const sx = box.x - pad;
  const sy = box.y - pad + offset;
  const sMeta = await sharp(shadow).metadata();
  if (sx >= 0 && sy >= 0 && sx + sMeta.width <= meta.width && sy + sMeta.height <= meta.height) {
    layers.push({ input: shadow, left: sx, top: sy });
  }
  layers.push({ input: mark, left: box.x, top: box.y });
  return sharp(buf).composite(layers).webp({ quality: 90 }).toBuffer();
}

const res = await fetch(`${SB_URL}/rest/v1/listing_photos?select=id,storage_path&order=id`, {
  headers: H,
});
if (!res.ok) throw new Error(`listing_photos read failed: ${res.status} ${await res.text()}`);
const rows = await res.json();

const SETTINGS = `gold-corner-h${MARK_HEIGHT_RATIO}-o${MARK_OPACITY}-r${MARGIN_RIGHT_RATIO}`;
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
