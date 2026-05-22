// ============================================================================
// Batta.tn — destructive DB wipe for testing.
//
// Clears listing / auction / payment / notification / KYC data across ALL
// users. Keeps auth.users + the profiles row, but resets each profile's
// KYC fields back to "none" so the next flow runs through KYC from scratch.
//
// Usage:
//   node scripts/wipe.mjs            # asks for confirmation
//   node scripts/wipe.mjs --yes      # skip prompt
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(URL, SVC, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Confirm unless --yes is passed. Destructive op — worth one keypress.
if (!process.argv.includes("--yes")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  const url = new URL(URL);
  const projectRef = url.hostname.split(".")[0];
  console.log(`About to WIPE listing/auction/payment/KYC data on project: ${projectRef}`);
  console.log("Auth users and their profile rows will be KEPT (KYC reset to 'none').");
  const answer = await ask("Type 'wipe' to continue: ");
  rl.close();
  if (answer.trim().toLowerCase() !== "wipe") {
    console.log("Aborted.");
    process.exit(0);
  }
}

// Delete-all helper. PostgREST DELETE without filter is rejected by the
// supabase-js client — we use a tautology filter so every row matches.
// Tables with composite PKs (no `id`, no `created_at`) get a custom
// fallback column via the second arg.
async function deleteAll(table, fallbackCol) {
  const { error, count } = await sb
    .from(table)
    .delete({ count: "exact" })
    .gte("created_at", "1900-01-01");
  if (!error) return count ?? 0;
  const col = fallbackCol ?? "id";
  const fallback = await sb
    .from(table)
    .delete({ count: "exact" })
    .not(col, "is", null);
  if (fallback.error) {
    console.warn(`  ! ${table}: ${error.message} (fallback on ${col} also failed: ${fallback.error.message})`);
    return 0;
  }
  return fallback.count ?? 0;
}

// FK-safe delete order: most-dependent rows first, then their parents.
// `properties.owner_id` is ON DELETE RESTRICT, but since we're keeping
// profiles we never touch that FK — properties are removed by id.
// auction_presence has a composite PK (user_id, auction_id) with no `id`
// or `created_at` column, so we tell deleteAll() which column to use.
const tables = [
  ["bids"],
  ["auction_deposits"],
  ["sixth_offers"],
  ["auction_presence", "user_id"],
  ["seller_payouts"],
  ["watchlist"],
  ["notifications"],
  ["inspections"],
  ["payments"],
  ["property_photos"],
  ["property_documents"],
  ["auctions"],
  ["properties"],
  ["kyc_submissions"],
];

console.log("→ Wiping tables…");
for (const [t, col] of tables) {
  const n = await deleteAll(t, col);
  console.log(`  ${n.toString().padStart(5)}  ${t}`);
}

// Reset KYC fields on every profile.
//
// profiles has a BEFORE UPDATE guard (_guard_profile_self_update) that
// blocks changes to kyc_status / kyc_*_at / trust_score / role unless
// `is_admin()` returns true. The service-role key bypasses RLS but NOT
// triggers, and is_admin() reads the JWT app_metadata.role claim —
// which for service-role is 'service_role', not 'admin'. So we sign in
// as the seed admin (app_metadata.role='admin') and run the update
// through that authed session.
console.log("→ Resetting profiles KYC…");
const ADMIN_EMAIL = "admin@batta.tn";
const ADMIN_PASSWORD = "Batta!2026";

// Make sure the admin exists with admin app_metadata + the known
// password. If a prior run set a different password, reset it here.
const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
let admin = list?.users.find((u) => u.email === ADMIN_EMAIL);
if (!admin) {
  const { data, error } = await sb.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "admin" },
    user_metadata: { full_name: "Batta Admin", role: "admin" },
  });
  if (error) {
    console.error(`  ! could not create admin user: ${error.message}`);
    process.exit(1);
  }
  admin = data.user;
} else {
  // Ensure password + role claim are in the known state.
  await sb.auth.admin.updateUserById(admin.id, {
    password: ADMIN_PASSWORD,
    app_metadata: { ...(admin.app_metadata ?? {}), role: "admin" },
  });
}

// Now sign in as admin via the user-facing client so we get a JWT with
// app_metadata.role='admin'. The PostgREST trigger reads that claim.
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!ANON) {
  console.error("  ! NEXT_PUBLIC_SUPABASE_ANON_KEY missing — needed for admin sign-in");
  process.exit(1);
}
const adminClient = createClient(URL, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error: signInErr } = await adminClient.auth.signInWithPassword({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
});
if (signInErr) {
  console.error(`  ! admin sign-in failed: ${signInErr.message}`);
  process.exit(1);
}

const { error: profErr, count: profCount } = await adminClient
  .from("profiles")
  .update(
    {
      kyc_status: "none",
      kyc_submitted_at: null,
      kyc_verified_at: null,
      trust_score: 0,
    },
    { count: "exact" }
  )
  .not("id", "is", null);
if (profErr) {
  console.error(`  ! profiles update failed: ${profErr.message}`);
} else {
  console.log(`  ✓ ${profCount ?? 0} profiles reset to kyc_status='none'`);
}

console.log("");
console.log("✅ Wipe complete.");
