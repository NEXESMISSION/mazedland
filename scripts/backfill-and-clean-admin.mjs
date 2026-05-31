// ============================================================================
// Batta.tn — one-off: backfill the 30 reset properties + clean stale admin data.
//
// The reset script created the 30 properties without lat/lng (a field bug), so
// the map section won't render a pin. Backfill coords/area/address from
// seed-listings by matching title. Also clear stale admin queues that aren't
// accounts/KYC: waitlist + popups.  KEEPS: profiles, KYC, inspectors.
//
//   node scripts/backfill-and-clean-admin.mjs --yes
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LISTINGS } from "./seed-listings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error("Missing Supabase env"); process.exit(1); }
if (!process.argv.includes("--yes")) { console.error("Pass --yes to run."); process.exit(1); }

const sb = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } });

// ── 1. Backfill coords/area/address on the 30 properties by title ──
console.log("→ Backfilling property coordinates / area / address…");
let fixed = 0;
for (const l of LISTINGS.slice(0, 30)) {
  const { error, count } = await sb
    .from("properties")
    .update(
      { lat: l.lat, lng: l.lng, area_sqm: l.area_sqm ?? null, address: l.address ?? null },
      { count: "exact" },
    )
    .eq("title", l.title);
  if (error) console.warn(`  ! ${l.slug}: ${error.message}`);
  else fixed += count ?? 0;
}
console.log(`  ✓ updated ${fixed} properties`);

// ── 2. Clear stale admin queues (NOT accounts / KYC / inspectors) ──
console.log("→ Clearing stale admin data (waitlist, popups)…");
for (const t of ["waitlist", "popups"]) {
  const { count, error } = await sb.from(t).delete({ count: "exact" }).not("id", "is", null);
  if (error) console.warn(`  ! ${t}: ${error.message}`);
  else console.log(`  ${String(count ?? 0).padStart(4)}  ${t}`);
}

console.log("\n✅ Done. Accounts, KYC and inspectors untouched.");
