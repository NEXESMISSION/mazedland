// ============================================================================
// Mazed Immo — production readiness check (READ-ONLY).
//
// Answers "what blocks taking real users today" against the LIVE project.
//
// It used to check an auction house: pg_cron auction ticks, cautions, counts of
// `properties` and `auctions`. Those tables are gone, so it printed "?" for the
// catalogue and a wall of stale-heartbeat alarms for jobs retired on purpose —
// a report nobody could act on, which is the same as no report.
//
//   1. Payment details     are the payee fields real, or example values?
//   2. Seller phones        can the public anon key read listings.contact_phone?
//   3. Privileges           can the client roles call service-only functions?
//   4. Scheduler            are the live jobs firing?
//   5. Catalogue            published annonces and active products
//   6. Admin                is there an account that can review receipts?
//   7. Environment          settings the site needs, and credentials it does not
//
// Writes nothing: service-key reads, one anonymous PostgREST read, and — when
// SB_HOST / SB_REF / SB_DB_PASSWORD are present — catalog queries inside a READ
// ONLY transaction. Exits 1 when there is a blocker, so CI can gate on it.
//
//   node scripts/launch-check.mjs
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local"), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
  );
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const blockers = [];
const warnings = [];
const ok = [];
const section = (title) => console.log(`\n### ${title}`);
const rule = () => console.log("─".repeat(72));

// Keep in sync with src/lib/payments/index.ts — DEFAULT_PAYEE / usablePayeeMethods.
const EXAMPLE_PAYEE = {
  rib: "07 003 0001234567890 78",
  iban: "TN59 0700 3000 0123 4567 8907 8",
  d17: "55 123 456",
};
const norm = (v) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

// Keep in sync with src/lib/observability/health.ts — RETIRED_HEARTBEATS.
const RETIRED_HEARTBEATS = new Set([
  "tick_auctions",
  "process_bid_events",
  "notify_auctions_ending_soon",
  "notify_final_payment_due",
]);

// Keep in sync with supabase/migrations/0157_privilege_hardening.sql.
const SERVICE_ONLY_FUNCTIONS = [
  "public._is_banned(uuid)",
  "public._notify_admins(text, text, text, text)",
  "public.check_auth_ratelimit(text)",
  "public.check_rate_limit(text, integer, integer)",
  "public.claim_emailable_notifications(integer, text[], timestamp with time zone, integer)",
  "public.claim_smsable_notifications(integer, text[], timestamp with time zone, integer)",
  "public.cleanup_old_notifications()",
  "public.cleanup_phone_otps()",
  "public.enqueue_waitlist(text, text, text, inet)",
  "public.final_payment_interval()",
  "public.notify_kyc_pending_reminder()",
  "public.prune_activity_log()",
  "public.prune_read_notifications()",
  "public.record_listing_view(uuid, text, uuid)",
  "public.stamp_cron_heartbeat(text, integer)",
  "public.update_inspection_status(uuid, public.inspection_status, text)",
];

async function checkPayee() {
  section("1. Payment details");
  const { data, error } = await sb.from("app_settings").select("key, value").like("key", "payee_%");
  if (error) throw error;
  const m = new Map(
    (data ?? []).map((r) => [r.key, typeof r.value === "string" ? r.value : r.value == null ? "" : String(r.value)]),
  );
  const name = m.get("payee_name") ?? "";
  const nameOk = name.trim() !== "" && !/batta/i.test(name);
  const real = (key, example) => norm(m.get(key)) !== "" && norm(m.get(key)) !== norm(example);
  const bank = nameOk && real("payee_rib", EXAMPLE_PAYEE.rib) && real("payee_iban", EXAMPLE_PAYEE.iban);
  const d17 = nameOk && real("payee_d17", EXAMPLE_PAYEE.d17);

  console.log(`  • beneficiary name: ${nameOk ? "set" : name ? `rejected ("${name}")` : "missing"}`);
  console.log(`  • bank transfer: ${bank ? "usable" : "not usable"}`);
  console.log(`  • D17: ${d17 ? "usable" : "not usable"}`);

  if (!bank && !d17) {
    blockers.push(
      "No payment method has real details. Checkout refuses payment until /admin/settings holds the company's real name and RIB/IBAN or D17 number.",
    );
  } else if (!bank || !d17) {
    warnings.push(`Only ${bank ? "bank transfer" : "D17"} is offered at checkout — the other method has no real details.`);
  } else {
    ok.push("Both payment methods carry real details.");
  }
}

async function checkPhones() {
  section("2. Seller phone numbers");
  const { data, error } = await anon
    .from("listings")
    .select("id, contact_phone")
    .eq("status", "published")
    .limit(20);
  if (error) {
    console.log(`  • anonymous read of contact_phone: blocked (${error.code})`);
    ok.push("listings.contact_phone is not readable with the public key.");
    return;
  }
  const exposed = (data ?? []).filter((r) => r.contact_phone).length;
  console.log(`  • anonymous read of contact_phone: ALLOWED — ${exposed} of ${data.length} rows expose a number`);
  if (exposed > 0) {
    blockers.push(
      "Seller phone numbers are readable with the public anon key. Apply supabase/migrations/0157_privilege_hardening.sql.",
    );
  }
}

async function checkPrivileges() {
  section("3. Privileges");
  if (!process.env.SB_HOST || !process.env.SB_REF || !process.env.SB_DB_PASSWORD) {
    console.log("  ? skipped — SB_HOST / SB_REF / SB_DB_PASSWORD not set");
    warnings.push("Direct DB credentials not set — function privileges were not checked.");
    return;
  }
  let client = null;
  for (const port of [5432, 6543]) {
    const c = new pg.Client({
      host: process.env.SB_HOST,
      port,
      user: `postgres.${process.env.SB_REF}`,
      password: process.env.SB_DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      client = c;
      break;
    } catch {
      /* try the next port */
    }
  }
  if (!client) {
    warnings.push("Could not connect to the database — function privileges were not checked.");
    return;
  }

  try {
    await client.query("begin transaction read only");

    const { rows } = await client.query(
      `select fn,
              has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE') as anon,
              has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE') as auth
         from unnest($1::text[]) as fn
        where to_regprocedure(fn) is not null`,
      [SERVICE_ONLY_FUNCTIONS],
    );
    const exposed = rows.filter((r) => r.anon || r.auth);
    for (const r of exposed) {
      const who = [r.anon && "anon", r.auth && "authenticated"].filter(Boolean).join(" + ");
      console.log(`  ✗ ${r.fn} — callable by ${who}`);
    }
    if (exposed.length) {
      blockers.push(
        `${exposed.length} service-only function(s) are callable by client roles. Apply 0157_privilege_hardening.sql.`,
      );
    } else {
      console.log(`  ✓ ${rows.length} service-only functions restricted to the service role`);
      ok.push("Service-only functions are not callable by client roles.");
    }

    const { rows: truncate } = await client.query(
      `select count(*)::int as n
         from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
        where ns.nspname = 'public' and cl.relkind = 'r'
          and (has_table_privilege('anon', cl.oid, 'TRUNCATE')
               or has_table_privilege('authenticated', cl.oid, 'TRUNCATE'))`,
    );
    console.log(`  • public tables where client roles hold TRUNCATE: ${truncate[0].n}`);
    if (truncate[0].n > 0) {
      warnings.push(`Client roles hold TRUNCATE on ${truncate[0].n} table(s). Removed by 0157_privilege_hardening.sql.`);
    }

    const { rows: jobs } = await client.query(`select jobname from cron.job where command ~* 'key='`);
    if (jobs.length) {
      console.log(`  ✗ cron jobs passing the secret in a URL: ${jobs.map((j) => j.jobname).join(", ")}`);
      warnings.push(
        "Cron jobs pass CRON_SECRET in a URL. Rotate the secret, then apply 0158_cron_secret_out_of_urls.sql.",
      );
    }

    await client.query("rollback");
  } finally {
    await client.end();
  }
}

async function checkScheduler() {
  section("4. Scheduler");
  const { data, error } = await sb.from("cron_heartbeat").select("job, last_run, max_age_seconds");
  if (error) throw error;
  const now = Date.now();
  let live = 0;
  let stale = 0;
  for (const h of data ?? []) {
    if (RETIRED_HEARTBEATS.has(h.job)) {
      console.log(`  · ${h.job}: retired job, ignored`);
      continue;
    }
    live++;
    const age = h.last_run ? Math.round((now - Date.parse(h.last_run)) / 1000) : null;
    const budget = Number(h.max_age_seconds) || 300;
    const late = age == null || age > budget;
    if (late) stale++;
    console.log(`  ${late ? "✗" : "✓"} ${h.job}: ${age == null ? "never ran" : `${age}s ago`} (budget ${budget}s)`);
  }
  if (live === 0) warnings.push("No live scheduled job has stamped a heartbeat yet.");
  else if (stale) blockers.push(`${stale} scheduled job(s) are not firing — /api/health reports 503.`);
  else ok.push(`${live} scheduled job(s) firing within budget.`);
}

async function checkCatalogue() {
  section("5. Catalogue");
  const { count: published } = await sb
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  const { count: products, error: productsError } = await sb
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  console.log(`  • published annonces: ${published ?? "?"}`);
  console.log(`  • active products (listing fees and options): ${productsError ? "?" : products}`);
  if (!published) warnings.push("No published annonce — the catalogue opens empty.");
  else ok.push(`${published} published annonce(s).`);
  if (!productsError && !products) warnings.push("No active product — every category publishes for free.");
}

async function checkAdmin() {
  section("6. Admin");
  const { count, error } = await sb
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) throw error;
  console.log(`  • admin accounts: ${count ?? 0}`);
  if (!count) blockers.push("No admin account — nobody can review receipts or annonces.");
  else ok.push(`${count} admin account(s).`);
}

async function checkEnvironment() {
  section("7. Environment (.env.local — the deployment's may differ)");
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    warnings.push("NEXT_PUBLIC_SITE_URL is not set — sitemap, OpenGraph tags and notification links guess the host.");
  }
  if (!process.env.NEXT_PUBLIC_CONTACT_EMAIL) {
    warnings.push("NEXT_PUBLIC_CONTACT_EMAIL is not set — /contact shows no e-mail address.");
  }
  const unused = [
    "KONNECT_API_KEY", "KONNECT_WALLET_ID", "PAYMEE_API_KEY",
    "FLOUCI_APP_TOKEN", "FLOUCI_APP_SECRET", "D17_MERCHANT_ID",
  ].filter((k) => process.env[k]);
  if (unused.length) {
    warnings.push(
      `Payment-gateway credentials that no code reads: ${unused.join(", ")}. Remove them from the deployment environment.`,
    );
  }
  console.log(`  • ${unused.length} unused credential(s) present`);
}

console.log("MAZED IMMO — PRODUCTION READINESS CHECK (read-only)");
console.log(`Project: ${new URL(SUPABASE_URL).host}`);
rule();
for (const step of [
  checkPayee, checkPhones, checkPrivileges, checkScheduler, checkCatalogue, checkAdmin, checkEnvironment,
]) {
  try {
    await step();
  } catch (e) {
    warnings.push(`${step.name} failed: ${e.message}`);
  }
}
rule();
console.log(`\n🔴 BLOCKERS (${blockers.length})`);
blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
console.log(`\n🟡 WARNINGS (${warnings.length})`);
warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
console.log(`\n🟢 OK (${ok.length})`);
ok.forEach((o) => console.log(`  • ${o}`));
rule();
process.exit(blockers.length ? 1 : 0);
