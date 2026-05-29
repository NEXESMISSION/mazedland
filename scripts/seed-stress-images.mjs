// ============================================================================
// Batta.tn — attach seed photos to image-less [STRESS] auction properties.
//
// The admin-stress seeder creates auctions whose properties have NO
// property_photos rows, so those auctions render with no image. This script
// fixes that by linking each image-less, auction-backed property to one of
// the 36 bundled static seed photos in public/properties/<slug>/1.webp,
// chosen by property type (land photos for land; building photos for
// villa / house / apartment / office / commercial) and round-robined for
// visual variety.
//
// Idempotent: only inserts for properties that currently have zero photos.
// Tagged (caption = '[STRESS] auto image') so it's reversible.
//
//   node scripts/seed-stress-images.mjs           # attach
//   node scripts/seed-stress-images.mjs --wipe    # remove only what it added
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error("Missing env"); process.exit(1); }
const sb = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } });

const WIPE = process.argv.includes("--wipe");
const TAG = "[STRESS] auto image";

// ─── Categorize the bundled seed image folders ──────────────────────────────
const folders = readdirSync(path.join(__dirname, "..", "public", "properties"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const BUILD_KW = ["villa", "maison", "vue-mer", "pieds-dans-eau", "garage", "americain", "charme", "front-mer"];
const isBuilding = (slug) => BUILD_KW.some((k) => slug.includes(k));
const buildingImgs = folders.filter(isBuilding).map((s) => `/properties/${s}/1.webp`).sort();
const landImgs = folders.filter((s) => !isBuilding(s)).map((s) => `/properties/${s}/1.webp`).sort();
console.log(`image pool → building: ${buildingImgs.length}, land: ${landImgs.length}`);

function imageForType(type, i) {
  const pool = type === "land" ? landImgs : buildingImgs;
  const fallback = pool.length ? pool : [...buildingImgs, ...landImgs];
  return fallback[i % fallback.length];
}

// ─── WIPE mode ───────────────────────────────────────────────────────────────
if (WIPE) {
  const { error, count } = await sb
    .from("property_photos")
    .delete({ count: "exact" })
    .eq("caption", TAG);
  if (error) { console.error("wipe failed:", error.message); process.exit(1); }
  console.log(`removed ${count ?? 0} auto images.`);
  process.exit(0);
}

// ─── Which auction-backed properties currently have no photo? ────────────────
const { data: auctions } = await sb.from("auctions").select("property_id").not("property_id", "is", null).limit(5000);
const auctionPropIds = [...new Set((auctions ?? []).map((a) => a.property_id))];

const { data: photos } = await sb.from("property_photos").select("property_id");
const withPhoto = new Set((photos ?? []).map((p) => p.property_id));
const missingIds = auctionPropIds.filter((id) => !withPhoto.has(id));
console.log(`auction-backed properties without photo: ${missingIds.length}`);
if (missingIds.length === 0) { console.log("nothing to do."); process.exit(0); }

// fetch their types
const missing = [];
for (let i = 0; i < missingIds.length; i += 300) {
  const chunk = missingIds.slice(i, i + 300);
  const { data } = await sb.from("properties").select("id, type").in("id", chunk);
  for (const p of data ?? []) missing.push(p);
}

// ─── Build + insert photo rows ───────────────────────────────────────────────
const rows = missing.map((p, i) => ({
  property_id: p.id,
  storage_path: imageForType(p.type, i),
  sort_order: 0,
  caption: TAG,
}));

let inserted = 0;
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  const { error } = await sb.from("property_photos").insert(batch);
  if (error) { console.error("insert failed:", error.message); process.exit(1); }
  inserted += batch.length;
  console.log(`  inserted ${inserted}/${rows.length}`);
}
console.log(`done — attached ${inserted} seed photos.`);
