// ============================================================================
// HOT-LOT BID LOAD TEST — measures place_bid throughput + latency under
// concurrency on a SINGLE auction (the "1000 users in the final minute"
// scenario that decides scale dimension #2).
//
// place_bid takes FOR UPDATE on the auction row, so every bid on one lot
// serializes. This drives N concurrent signed-in users hammering one auction
// and reports the lock-contention curve: p50/p95/p99 round-trip latency,
// throughput (bids/sec), and the outcome histogram.
//
// RUNS WITH PLAIN `node` (no Docker) against ANY Supabase project — point it at
// a THROWAWAY STAGING project, never prod. It refuses to run against the known
// prod ref unless FORCE_PROD=1 (don't).
//
// Usage (PowerShell):
//   $env:LOADTEST_SUPABASE_URL="https://<staging-ref>.supabase.co"
//   $env:LOADTEST_SERVICE_KEY="<staging service_role key>"
//   $env:LOADTEST_ANON_KEY="<staging anon key>"
//   $env:USERS="300"; $env:DURATION_SEC="60"
//   node scripts/loadtest/hot-lot-bids.mjs
//
// Apply migrations to the staging project first: `supabase db push` against it.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.LOADTEST_SUPABASE_URL ?? "";
const SVC = process.env.LOADTEST_SERVICE_KEY ?? "";
const ANON = process.env.LOADTEST_ANON_KEY ?? "";
const USERS = Number(process.env.USERS ?? 200);
const DURATION_SEC = Number(process.env.DURATION_SEC ?? 60);
const THINK_MS = Number(process.env.THINK_MS ?? 250); // pause between a user's bids
const PROD_REF = "sajxoovrsoacfnytiijv";

if (!URL || !SVC || !ANON) {
  console.error("Set LOADTEST_SUPABASE_URL / LOADTEST_SERVICE_KEY / LOADTEST_ANON_KEY (a STAGING project).");
  process.exit(1);
}
if (URL.includes(PROD_REF) && process.env.FORCE_PROD !== "1") {
  console.error(`REFUSING: ${URL} is the PROD project. This places real bids. Point at staging.`);
  process.exit(1);
}

const svc = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = "LoadTest!2026x";
const created = [];

async function mkUser(verified) {
  const email = `lt-${randomUUID()}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: "Load Test" },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const id = data.user.id;
  created.push(id);
  if (verified) {
    await svc.from("profiles").update({ kyc_status: "verified", kyc_verified_at: new Date().toISOString() }).eq("id", id);
  }
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (sErr) throw new Error(`sign-in: ${sErr.message}`);
  return { id, client };
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`Hot-lot bid load test → ${URL}\n  users=${USERS} duration=${DURATION_SEC}s think=${THINK_MS}ms`);

  // 1) Seed: owner + one live english auction far from closing, N verified bidders w/ deposits.
  console.log("Seeding owner + auction + bidders…");
  const owner = await mkUser(false);
  const { data: prop } = await svc.from("properties").insert({
    owner_id: owner.id, title: `LoadTest ${randomUUID().slice(0, 8)}`, type: "apartment", governorate: "Tunis", status: "ready",
  }).select("id").single();
  const { data: auc } = await svc.from("auctions").insert({
    property_id: prop.id, type: "english", listing_type: "auction",
    opening_price: 100000, starts_at: new Date(Date.now() - 3600e3).toISOString(),
    ends_at: new Date(Date.now() + 7 * 24 * 3600e3).toISOString(), // 7d out: never closes mid-test
    status: "live", extend_window_seconds: 1, extend_by_seconds: 1,
  }).select("id").single();
  const auctionId = auc.id;

  const bidders = [];
  for (let i = 0; i < USERS; i++) {
    const u = await mkUser(true);
    await svc.from("payments").insert({
      user_id: u.id, kind: "deposit_lock", provider: "manual", amount: 10000, status: "captured", auction_id: auctionId,
    });
    bidders.push(u);
    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${USERS} bidders ready`);
  }

  // 2) Load: every bidder loops calling place_bid until the clock runs out.
  console.log(`\nFiring ${USERS} concurrent bidders for ${DURATION_SEC}s…`);
  const latencies = [];
  const outcomes = {};
  const deadline = Date.now() + DURATION_SEC * 1000;
  let nextAmount = 100000;

  const runUser = async (u) => {
    while (Date.now() < deadline) {
      // Always try to outbid the running price by a wide margin so some succeed.
      nextAmount += 1000;
      const amt = nextAmount;
      const t0 = performance.now();
      const { data, error } = await u.client.rpc("place_bid", { p_auction_id: auctionId, p_amount: amt, p_max_amount: null, p_ip: null });
      latencies.push(performance.now() - t0);
      const code = error ? (error.message.match(/[a-z_]+/)?.[0] ?? "error") : (data?.ok ? "ok" : "noop");
      outcomes[code] = (outcomes[code] ?? 0) + 1;
      if (THINK_MS) await new Promise((r) => setTimeout(r, THINK_MS));
    }
  };
  await Promise.all(bidders.map(runUser));

  // 3) Report.
  const sorted = latencies.slice().sort((a, b) => a - b);
  const total = latencies.length;
  const secs = DURATION_SEC;
  console.log(`\n── RESULTS ──────────────────────────────────────────────`);
  console.log(`calls: ${total}  throughput: ${(total / secs).toFixed(1)}/s`);
  console.log(`latency ms  p50=${pct(sorted, 50).toFixed(0)}  p95=${pct(sorted, 95).toFixed(0)}  p99=${pct(sorted, 99).toFixed(0)}  max=${(sorted.at(-1) ?? 0).toFixed(0)}`);
  console.log(`outcomes:`, outcomes);
  console.log(`\nRead p95/p99: if they balloon as USERS rises, you've hit the FOR UPDATE`);
  console.log(`serialization ceiling. Re-run at USERS=50/200/500 to map the curve.`);

  // 4) Cleanup.
  console.log("\nCleaning up seeded users…");
  for (const id of created) await svc.auth.admin.deleteUser(id).catch(() => {});
  console.log("done.");
}

main().catch(async (e) => {
  console.error("load test failed:", e.message);
  for (const id of created) await svc.auth.admin.deleteUser(id).catch(() => {});
  process.exit(1);
});
