// ============================================================================
// Batta.tn — GO-TO-MARKET readiness check (READ-ONLY).
//
// Answers "what actually blocks a real launch" against the LIVE prod DB:
//   1. Is pg_cron scheduled + firing?  (else auctions never close)
//   2. Are the PAYEE bank details real or still placeholder?
//      (manual payment model — buyers wire money to whatever is here)
//   3. Is monetization (fees / deposit) configured?
//   4. Is there a real admin account?
//   5. Is there real content (properties / auctions)?
//
// Writes nothing. Usage:  node scripts/launch-check.mjs
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } });

// The placeholder/test payee values baked into lib/payments/index.ts. If the
// live app_settings match these (or are absent), buyers wire to a fake account.
const PLACEHOLDER_PAYEE = {
  payee_name: "Batta Tunisia SARL",
  payee_bank: "Société Tunisienne de Banque (STB)",
  payee_rib: "07 003 0001234567890 78",
  payee_iban: "TN59 0700 3000 0123 4567 8907 8",
  payee_d17: "55 123 456",
};

const blockers = [];
const warnings = [];
const ok = [];
const line = () => console.log("─".repeat(72));

async function checkCron() {
  console.log("\n### 1. pg_cron — does the auction engine actually run?");
  try {
    const { data, error } = await sb.rpc("list_cron_jobs");
    if (error) throw error;
    const jobs = data ?? [];
    if (jobs.length === 0) {
      blockers.push("pg_cron has ZERO scheduled jobs — auctions will never close, notifications never send. Enable pg_cron + schedule tick/notify jobs in prod.");
      console.log("  ✗ no scheduled jobs");
    } else {
      for (const j of jobs) console.log(`  • ${JSON.stringify(j)}`);
      ok.push(`pg_cron has ${jobs.length} scheduled job(s).`);
    }
  } catch (e) {
    warnings.push(`Could not read list_cron_jobs (${e.message}). Verify pg_cron manually in the Supabase dashboard.`);
    console.log(`  ? list_cron_jobs failed: ${e.message}`);
  }

  // Heartbeat: are jobs firing recently?
  // cron_heartbeat is (job, last_run) — there is NO last_run_at / max_age_seconds
  // column (see migration 0092), so selecting those silently errored and this
  // whole check was a no-op. Read the real column and apply the budget HERE:
  // the every-minute engine jobs must be fresh within 5 min; less-frequent
  // jobs (notifications, prune, email drain) get a generous default.
  const STALE_BUDGET = { tick_auctions: 300, process_bid_events: 300 };
  const DEFAULT_BUDGET = 3600;
  try {
    const { data } = await sb.from("cron_heartbeat").select("job, last_run");
    if (data && data.length) {
      const now = Date.now();
      for (const h of data) {
        const budget = STALE_BUDGET[h.job] ?? DEFAULT_BUDGET;
        const age = h.last_run ? Math.round((now - new Date(h.last_run).getTime()) / 1000) : null;
        const stale = age == null || age > budget;
        console.log(`  • ${h.job}: last ${age == null ? "NEVER" : age + "s ago"} (budget ${budget}s) ${stale ? "✗ STALE" : "✓"}`);
        if (stale) warnings.push(`Cron heartbeat '${h.job}' is stale — job not firing in prod.`);
      }
    } else {
      warnings.push("cron_heartbeat is empty — no scheduler has stamped a heartbeat yet.");
    }
  } catch (e) { warnings.push(`Could not read cron_heartbeat (${e.message}).`); }
}

async function checkPayee() {
  console.log("\n### 2. Payee bank details — REAL or placeholder?");
  const keys = Object.keys(PLACEHOLDER_PAYEE);
  const { data } = await sb.from("app_settings").select("key, value").in("key", keys);
  const map = new Map((data ?? []).map((r) => [r.key, typeof r.value === "string" ? r.value : JSON.stringify(r.value)]));
  let anyPlaceholder = false, anyMissing = false;
  for (const k of keys) {
    const v = map.get(k);
    const isMissing = v == null || v === "";
    const isPlaceholder = v != null && String(v).replace(/"/g, "") === PLACEHOLDER_PAYEE[k];
    if (isMissing) anyMissing = true;
    if (isPlaceholder) anyPlaceholder = true;
    console.log(`  • ${k}: ${isMissing ? "(MISSING → falls back to placeholder)" : v} ${isPlaceholder ? "✗ PLACEHOLDER" : isMissing ? "✗" : "✓"}`);
  }
  if (anyPlaceholder || anyMissing) {
    blockers.push("Payee bank details are placeholder/missing — buyers would wire real money to a FAKE account. Set payee_rib/iban/d17/name/bank in /admin/settings to the real Batta company account BEFORE launch.");
  } else {
    ok.push("Payee bank details look real (no placeholders).");
  }
}

async function checkMonetization() {
  console.log("\n### 3. Monetization (fees / deposit) configured?");
  const keys = ["fee_listing_auction", "fee_listing_direct", "deposit", "auction_antisnipe", "commission_rate"];
  const { data } = await sb.from("app_settings").select("key, value").in("key", keys);
  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  for (const k of keys) {
    const present = map.has(k);
    console.log(`  • ${k}: ${present ? JSON.stringify(map.get(k)) : "(default — not set in DB)"}`);
  }
  warnings.push("Monetization keys not set in DB fall back to code defaults (fee 20/15 TND, deposit 10%). Confirm these are the values you want in /admin/settings.");
}

async function checkAdmin() {
  console.log("\n### 4. Admin account(s)");
  const { data, error } = await sb.from("profiles").select("id, role").eq("role", "admin");
  if (error) { warnings.push(`Could not count admins: ${error.message}`); return; }
  const n = (data ?? []).length;
  console.log(`  • ${n} admin profile(s)`);
  if (n === 0) blockers.push("No admin account — nobody can review receipts/KYC/payouts. Provision one.");
  else ok.push(`${n} admin account(s) exist.`);
}

async function checkContent() {
  console.log("\n### 5. Content");
  for (const tbl of ["properties", "auctions"]) {
    const { count } = await sb.from(tbl).select("id", { count: "exact", head: true });
    console.log(`  • ${tbl}: ${count ?? "?"}`);
    if ((count ?? 0) === 0) warnings.push(`No ${tbl} yet — launch needs real listings.`);
  }
  // Auctions actually open for bidding right now?
  const { count: live } = await sb.from("auctions").select("id", { count: "exact", head: true }).in("status", ["live", "extending", "scheduled"]);
  console.log(`  • auctions live/scheduled: ${live ?? 0}`);
}

console.log("BATTA.TN — GO-TO-MARKET READINESS CHECK");
console.log(`Project: ${URL}`);
line();
await checkCron();
await checkPayee();
await checkMonetization();
await checkAdmin();
await checkContent();
line();
console.log(`\n🔴 BLOCKERS (${blockers.length}) — must fix before taking real users:`);
blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
console.log(`\n🟡 WARNINGS (${warnings.length}):`);
warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
console.log(`\n🟢 OK (${ok.length}):`);
ok.forEach((o) => console.log(`  • ${o}`));
line();
