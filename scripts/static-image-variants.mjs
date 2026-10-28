// ============================================================================
// Make the sizes of the static photos that next/image asks for
// (src/lib/imageLoader.ts): public/properties/**/*.webp and public/auth-hero.webp,
// each as <name>.w384.webp, .w640 and .w828 next to it (past 828, the original).
//
//   node scripts/static-image-variants.mjs          # makes the missing ones
//   node scripts/static-image-variants.mjs --force  # remakes them all
//
// Run it after adding or replacing a photo in /public; a test fails while a
// size is missing. Never wider than the original (a small photo's sizes are
// the original, re-encoded).
// ============================================================================
import sharp from "sharp";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WIDTHS = [384, 640, 828];
const FORCE = process.argv.includes("--force");

function sources() {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.webp$/.test(e.name) && !/\.w\d+\.webp$/.test(e.name)) out.push(p);
    }
  })(path.join("public", "properties"));
  out.push(path.join("public", "auth-hero.webp"));
  return out;
}

let made = 0;
let bytes = 0;
for (const src of sources()) {
  for (const w of WIDTHS) {
    const dest = src.replace(/\.webp$/, `.w${w}.webp`);
    if (!FORCE && existsSync(dest)) continue;
    await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 72 }).toFile(dest);
    made++;
    bytes += statSync(dest).size;
  }
}
console.log(`made ${made} files, ${Math.round(bytes / 1024)} kB`);
