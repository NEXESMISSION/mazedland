// ============================================================================
// REALTIME FAN-OUT LOAD TEST — measures the scale ceiling of dimension #3.
//
// On a hot lot, every bid INSERT is broadcast (postgres_changes) to EVERY
// viewer subscribed to that auction. N viewers x M bids = N*M messages. This
// opens N concurrent realtime subscriptions to one auction's bids channel,
// fires M bid INSERTs, and measures: delivery rate (received / expected),
// end-to-end latency (insert -> client receive), and per-viewer receipts.
// If delivery drops or latency balloons as VIEWERS rises, you've hit the
// Supabase Realtime throughput / connection ceiling for your plan tier.
//
// RUNS WITH `node` (no Docker) against ANY Supabase project. Point at a
// THROWAWAY STAGING project — refuses the prod ref unless FORCE_PROD=1.
// Needs Node 22+ (global WebSocket) or `npm i -D ws` (auto-polyfilled below).
//
// Usage (PowerShell):
//   $env:LOADTEST_SUPABASE_URL="https://<staging-ref>.supabase.co"
//   $env:LOADTEST_SERVICE_KEY="<service_role>"; $env:LOADTEST_ANON_KEY="<anon>"
//   $env:VIEWERS="300"; $env:BIDS="80"
//   node scripts/loadtest/realtime-fanout.mjs
// ============================================================================

// Polyfill WebSocket for Node < 22 (realtime-js needs a global WebSocket).
if (typeof globalThis.WebSocket === "undefined") {
  try { globalThis.WebSocket = (await import("ws")).default; }
  catch { console.error("Node < 22 and `ws` not installed. Run `npm i -D ws` or use Node 22+."); process.exit(1); }
}

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.LOADTEST_SUPABASE_URL ?? "";
const SVC = process.env.LOADTEST_SERVICE_KEY ?? "";
const ANON = process.env.LOADTEST_ANON_KEY ?? "";
const VIEWERS = Number(process.env.VIEWERS ?? 200);
const BIDS = Number(process.env.BIDS ?? 50);
const BID_GAP_MS = Number(process.env.BID_GAP_MS ?? 200);
const PROD_REF = "sajxoovrsoacfnytiijv";

if (!URL || !SVC || !ANON) { console.error("Set LOADTEST_SUPABASE_URL / LOADTEST_SERVICE_KEY / LOADTEST_ANON_KEY (staging)."); process.exit(1); }
if (URL.includes(PROD_REF) && process.env.FORCE_PROD !== "1") { console.error(`REFUSING: ${URL} is PROD. Point at staging.`); process.exit(1); }

const svc = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
const subs = [];
const createdUsers = [];

// insert amount -> send timestamp, so each receipt can compute latency. Declared
// up front so the realtime handlers (registered below) close over it.
const sentAt = new Map();
const recvLatencies = [];

function pct(s, p) { return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; }

async function main() {
  console.log(`Realtime fan-out test -> ${URL}\n  viewers=${VIEWERS} bids=${BIDS} gap=${BID_GAP_MS}ms`);

  // Seed: an owner, one live english auction, a few bidders to attribute inserts to.
  const { data: ownerU } = await svc.auth.admin.createUser({ email: `lt-${randomUUID()}@example.test`, password: "LoadTest!2026x", email_confirm: true });
  createdUsers.push(ownerU.user.id);
  const { data: prop } = await svc.from("properties").insert({ owner_id: ownerU.user.id, title: `RT ${randomUUID().slice(0, 6)}`, type: "apartment", governorate: "Tunis", status: "ready" }).select("id").single();
  const { data: auc } = await svc.from("auctions").insert({
    property_id: prop.id, type: "english", listing_type: "auction", opening_price: 100000,
    starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), status: "live",
  }).select("id").single();
  const auctionId = auc.id;
  const bidders = [];
  for (let i = 0; i < 5; i++) {
    const { data } = await svc.auth.admin.createUser({ email: `lt-${randomUUID()}@example.test`, password: "LoadTest!2026x", email_confirm: true });
    createdUsers.push(data.user.id); bidders.push(data.user.id);
  }

  // Open VIEWERS subscriptions to the bids INSERT channel (anon = a public viewer).
  console.log(`Opening ${VIEWERS} realtime subscriptions…`);
  const perSubCount = new Array(VIEWERS).fill(0);
  let subscribed = 0;
  await Promise.all(Array.from({ length: VIEWERS }, (_, i) => new Promise((resolve) => {
    const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    subs.push(c);
    c.channel(`rt-test:${auctionId}:${i}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bids", filter: `auction_id=eq.${auctionId}` }, (payload) => {
        perSubCount[i] += 1;
        const t = sentAt.get(Number(payload?.new?.amount));
        if (t) recvLatencies.push(Date.now() - t);
      })
      .subscribe((st) => { if (st === "SUBSCRIBED") { subscribed++; resolve(); } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") resolve(); });
  })));
  console.log(`  ${subscribed}/${VIEWERS} subscribed`);
  await new Promise((r) => setTimeout(r, 1000)); // settle

  // Fire BIDS inserts, stamping send time so each receipt computes latency.
  console.log(`Firing ${BIDS} bid inserts…`);
  for (let b = 0; b < BIDS; b++) {
    const amount = 100000 + b * 1000;
    sentAt.set(amount, Date.now());
    await svc.from("bids").insert({ auction_id: auctionId, bidder_id: bidders[b % bidders.length], amount, is_proxy: false });
    if (BID_GAP_MS) await new Promise((r) => setTimeout(r, BID_GAP_MS));
  }
  await new Promise((r) => setTimeout(r, 3000)); // let late messages land

  const totalReceived = perSubCount.reduce((a, c) => a + c, 0);
  const expected = subscribed * BIDS;
  const deliveryRate = expected ? (100 * totalReceived / expected) : 0;
  const active = perSubCount.slice(0, subscribed);
  const sortedLat = recvLatencies.slice().sort((a, b) => a - b);

  console.log(`\n── RESULTS ──────────────────────────────────────────────`);
  console.log(`subscribed viewers: ${subscribed}/${VIEWERS}`);
  console.log(`messages received: ${totalReceived} / expected ${expected}  → delivery ${deliveryRate.toFixed(1)}%`);
  console.log(`per-viewer receipts of ${BIDS}: min=${Math.min(...active)} max=${Math.max(...active)}`);
  console.log(`insert→receive latency ms: p50=${pct(sortedLat, 50).toFixed(0)} p95=${pct(sortedLat, 95).toFixed(0)} p99=${pct(sortedLat, 99).toFixed(0)} max=${(sortedLat.at(-1) ?? 0).toFixed(0)}`);
  console.log(`\nIf delivery% < ~99, min << ${BIDS}, or p95 latency climbs sharply as VIEWERS`);
  console.log(`rises, you're at the Realtime ceiling for this tier. Map it: VIEWERS=100/300/1000.`);

  console.log("\nCleaning up…");
  for (const c of subs) { try { await c.removeAllChannels(); } catch {} }
  for (const id of createdUsers) await svc.auth.admin.deleteUser(id).catch(() => {});
  console.log("done.");
  process.exit(0);
}

main().catch(async (e) => {
  console.error("realtime test failed:", e.message);
  for (const id of createdUsers) await svc.auth.admin.deleteUser(id).catch(() => {});
  process.exit(1);
});
