// ============================================================================
// Batta.tn — full reset to 30 clean live auctions.
//
// DESTRUCTIVE. Deletes ALL marketplace activity, then seeds exactly 30 fresh
// auctions from the real Sfax listings (with /public/properties photos), each
// status='live' with a random end time 1h–24h out, no bids.
//
// KEEPS: accounts (auth.users + profiles) and their KYC status — untouched.
// CLEARS: bids, deposits, sixth_offers, presence, payouts, watchlist,
//         notifications, inspections, payments, property_photos/documents,
//         auctions, properties. (kyc_submissions is intentionally KEPT.)
//
//   node scripts/reset-30-auctions.mjs --yes
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LISTINGS } from "./seed-listings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error("Missing Supabase env"); process.exit(1); }
if (!process.argv.includes("--yes")) {
  console.error("Refusing to run without --yes (this is destructive).");
  process.exit(1);
}

const sb = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } });
const COUNT = 30;

// FK-safe delete order (mirrors wipe.mjs). kyc_submissions is NOT here — KYC stays.
async function deleteAll(table, fallbackCol) {
  const { error, count } = await sb.from(table).delete({ count: "exact" }).gte("created_at", "1900-01-01");
  if (!error) return count ?? 0;
  const col = fallbackCol ?? "id";
  const fb = await sb.from(table).delete({ count: "exact" }).not(col, "is", null);
  if (fb.error) { console.warn(`  ! ${table}: ${error.message}`); return 0; }
  return fb.count ?? 0;
}

const tables = [
  ["bids"], ["auction_deposits"], ["sixth_offers"], ["auction_presence", "user_id"],
  ["seller_payouts"], ["watchlist"], ["notifications"], ["inspections"],
  ["payments"], ["property_photos"], ["property_documents"], ["auctions"], ["properties"],
];

console.log("→ Wiping marketplace data (accounts + KYC kept)…");
for (const [t, col] of tables) {
  const n = await deleteAll(t, col);
  console.log(`  ${String(n).padStart(5)}  ${t}`);
}

// Pick owners from existing profiles (keep accounts). Prefer non-admin sellers.
const { data: profs, error: profErr } = await sb
  .from("profiles")
  .select("id, role")
  .order("created_at", { ascending: true });
if (profErr || !profs || profs.length === 0) {
  console.error("No profiles to own listings:", profErr?.message); process.exit(1);
}
const owners = (profs.filter((p) => p.role !== "admin").length
  ? profs.filter((p) => p.role !== "admin")
  : profs
).map((p) => p.id);
console.log(`→ Owners available: ${owners.length}`);

// Seed 30 properties + photos + live auctions.
const picks = LISTINGS.slice(0, COUNT);
const nowMs = Date.now();
let made = 0;

for (const [i, listing] of picks.entries()) {
  const owner = owners[i % owners.length];
  const propId = randomUUID();
  const { error: pErr } = await sb.from("properties").insert({
    id: propId,
    owner_id: owner,
    title: listing.title,
    description: listing.description,
    type: listing.type,
    governorate: listing.governorate,
    delegation: listing.delegation,
    address: listing.delegation,
    area_sqm: listing.area,
    rooms: listing.rooms,
    bathrooms: listing.bathrooms,
    status: "ready",
  });
  if (pErr) { console.error(`  ✗ property ${listing.slug}: ${pErr.message}`); continue; }

  const photos = (listing.images || []).map((_, idx) => ({
    property_id: propId,
    storage_path: `/properties/${listing.slug}/${idx + 1}.webp`,
    sort_order: idx,
  }));
  if (photos.length) {
    const { error: phErr } = await sb.from("property_photos").insert(photos);
    if (phErr) console.error(`  ! photos ${listing.slug}: ${phErr.message}`);
  }

  // Random end 1h–24h out; opened a minute ago; empty (no bids).
  const hours = 1 + Math.floor(Math.random() * 23) + Math.random(); // 1.0–24.x
  const { error: aErr } = await sb.from("auctions").insert({
    id: randomUUID(),
    property_id: propId,
    type: "english",
    listing_type: "auction",
    opening_price: listing.price,
    current_price: listing.price,
    starts_at: new Date(nowMs - 60_000).toISOString(),
    ends_at: new Date(nowMs + hours * 36e5).toISOString(),
    status: "live",
  });
  if (aErr) { console.error(`  ✗ auction ${listing.slug}: ${aErr.message}`); continue; }
  made += 1;
}

console.log(`\n✅ Reset complete — ${made} live auctions, accounts + KYC untouched.`);
