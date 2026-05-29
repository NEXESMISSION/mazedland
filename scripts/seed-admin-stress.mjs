// ============================================================================
// Batta.tn — ADMIN STRESS seeder
//
// Floods every admin queue (Création, Paiements, Remboursements, Paiements
// vendeurs, KYC) with realistic volume so the admin UX can be evaluated at
// "hundreds of sales/day" scale. Service-role; bypasses RLS.
//
// Everything it writes is identifiable for cleanup:
//   · properties.title starts with "[STRESS]"
//   · payments.metadata.stress = true
//   · profiles via emails stress.buyerN@batta.tn
//   · seller_payouts.payment_method = "stress"
//   · kyc_submissions.full_name starts with "[STRESS]"
//
//   node scripts/seed-admin-stress.mjs            # seed
//   node scripts/seed-admin-stress.mjs --wipe     # remove only stress data
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error("Missing env"); process.exit(1); }
const sb = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } });

const MARK = "[STRESS]";
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const daysAgo = (d) => iso(-d * 86_400_000);
const hoursFromNow = (h) => iso(h * 3_600_000);
const GOVS = ["Tunis", "Sfax", "Sousse", "Nabeul", "Ariana", "Monastir", "Bizerte", "Gabès", "Kairouan", "Médenine"];
const TYPES = ["apartment", "villa", "house", "land", "commercial", "office"];
const FNAMES = ["Ahmed", "Sami", "Leila", "Fatma", "Mohamed", "Nour", "Yassine", "Sonia", "Karim", "Rania", "Hatem", "Ines", "Bilel", "Maha", "Walid"];
const LNAMES = ["Ben Ali", "Trabelsi", "Gharbi", "Jelassi", "Mansour", "Khelifi", "Bouzid", "Sassi", "Ferchichi", "Aouadi"];

const PASSWORD = "Batta!2026";
const N_BUYERS = 60;

// ─── wipe mode ──────────────────────────────────────────────────────────────
if (process.argv.includes("--wipe")) {
  console.log("→ Wiping stress data…");
  const { data: sp } = await sb.from("properties").select("id").ilike("title", `${MARK}%`);
  const pids = (sp ?? []).map((p) => p.id);
  if (pids.length) {
    const { data: sa } = await sb.from("auctions").select("id").in("property_id", pids);
    const aids = (sa ?? []).map((a) => a.id);
    if (aids.length) {
      await sb.from("bids").delete().in("auction_id", aids);
      await sb.from("auction_deposits").delete().in("auction_id", aids);
      await sb.from("payments").delete().in("auction_id", aids);
      await sb.from("auctions").delete().in("id", aids);
    }
    await sb.from("payments").delete().in("property_id", pids);
    await sb.from("property_photos").delete().in("property_id", pids);
    await sb.from("property_documents").delete().in("property_id", pids);
    await sb.from("properties").delete().in("id", pids);
  }
  await sb.from("seller_payouts").delete().eq("payment_method", "stress");
  await sb.from("kyc_submissions").delete().ilike("full_name", `${MARK}%`);
  console.log("  ✓ stress data removed");
  process.exit(0);
}

// ─── 1. buyer pool ───────────────────────────────────────────────────────────
console.log(`→ Ensuring ${N_BUYERS} stress users…`);
const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
const byEmail = new Map((list?.users ?? []).map((u) => [u.email, u.id]));
const pool = [];
for (let i = 0; i < N_BUYERS; i++) {
  const email = `stress.buyer${i}@batta.tn`;
  let id = byEmail.get(email);
  if (!id) {
    const name = `${pick(FNAMES)} ${pick(LNAMES)}`;
    const { data, error } = await sb.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: name, role: "individual" },
    });
    if (error) { console.warn(`  user ${email}: ${error.message}`); continue; }
    id = data.user.id;
    await sb.from("profiles").update({
      full_name: name, role: "individual", governorate: pick(GOVS),
      kyc_status: "verified", trust_score: rnd(40, 95),
    }).eq("id", id);
  }
  pool.push(id);
}
console.log(`  ✓ ${pool.length} users`);

// ─── 2. properties: pending (Création) + ready (→ auctions) ───────────────────
console.log("→ Properties…");
const pendingRows = [], readyRows = [];
for (let i = 0; i < 600; i++) {
  const t = pick(TYPES), g = pick(GOVS);
  const lt = Math.random() < 0.7 ? "auction" : "direct";
  pendingRows.push({
    owner_id: pick(pool), title: `${MARK} ${t} ${g} #${i}`, description: "Annonce de test (stress).",
    type: t, governorate: g, area_sqm: rnd(80, 600), status: "pending_review",
    listing_type: lt,
    sale_price: lt === "direct" ? rnd(80, 900) * 1000 : null,
  });
}
for (let i = 0; i < 800; i++) {
  const t = pick(TYPES), g = pick(GOVS);
  readyRows.push({
    owner_id: pick(pool), title: `${MARK} ${t} ${g} R#${i}`, description: "Annonce de test (stress).",
    type: t, governorate: g, area_sqm: rnd(80, 600), status: "ready",
    listing_type: "auction", reviewed_at: daysAgo(rnd(1, 30)),
  });
}
const { data: pendingProps, error: e1 } = await sb.from("properties").insert(pendingRows).select("id, owner_id");
if (e1) throw new Error(`pending props: ${e1.message}`);
const { data: readyProps, error: e2 } = await sb.from("properties").insert(readyRows).select("id, owner_id");
if (e2) throw new Error(`ready props: ${e2.message}`);
console.log(`  ✓ ${pendingProps.length} pending + ${readyProps.length} ready`);

// ─── 3. listing-fee receipts pending_review (Création queue) ──────────────────
console.log("→ Listing-fee receipts (Création)…");
const feeRows = pendingProps.slice(0, 500).map((p) => ({
  user_id: p.owner_id, property_id: p.id, kind: "listing_fee", provider: pick(["bank_transfer", "d17"]),
  amount: pick([15, 20, 35, 50]), status: "pending_review",
  receipt_uploaded_at: daysAgo(rnd(0, 5)),
  metadata: { stress: true, promos: { home_featured: Math.random() < 0.4, top_listed: Math.random() < 0.3, banner: Math.random() < 0.2 } },
}));
await sb.from("payments").insert(feeRows);
console.log(`  ✓ ${feeRows.length}`);

// ─── 4. auctions (ended + live) with deposits + bids ──────────────────────────
console.log("→ Auctions + deposits + bids…");
// Precompute the full plan (bidders/bids/winner) so the winner can be set in
// the INSERT — no per-row UPDATE afterwards (that was the scale bottleneck).
const LIVE_FROM = Math.max(0, readyProps.length - 200); // last 200 live, rest ended
const plans = readyProps.map((p, i) => {
  const live = i >= LIVE_FROM;
  const open = rnd(60, 800) * 1000;
  const sold = !live && Math.random() < 0.6;
  const bidders = [...new Set(Array.from({ length: rnd(2, 6) }, () => pick(pool)))];
  let amt = open;
  const bids = bidders.map((uid) => { amt += rnd(3, 25) * 1000; return { uid, amount: amt }; });
  const winner = sold ? bidders[bidders.length - 1] : null; // highest bidder
  const winnerAmount = winner ? amt : null;
  return {
    p, live, open, bidders, bids, winner, winnerAmount,
    status: live ? "live" : (sold ? "ended_sold" : "ended_unsold"),
    auctionId: null,
  };
});
const aucInsert = plans.map((pl) => ({
  property_id: pl.p.id, type: "english", listing_type: "auction",
  opening_price: pl.open, reserve_price: Math.round(pl.open * 1.2),
  starts_at: daysAgo(pl.live ? 1 : rnd(15, 40)),
  ends_at: pl.live ? hoursFromNow(rnd(2, 72)) : daysAgo(rnd(1, 12)),
  status: pl.status,
  current_price: pl.winner ? pl.winnerAmount : pl.open,
  winner_user_id: pl.winner, winner_amount: pl.winnerAmount,
  hammer_at: pl.winner ? daysAgo(rnd(1, 10)) : null,
}));
const aucIds = [];
for (let i = 0; i < aucInsert.length; i += 200) {
  const { data, error } = await sb.from("auctions").insert(aucInsert.slice(i, i + 200)).select("id");
  if (error) throw new Error(`auctions: ${error.message}`);
  aucIds.push(...data.map((d) => d.id));
}
plans.forEach((pl, i) => { pl.auctionId = aucIds[i]; });

const depRows = [], bidRows = [], entryPayRows = [];
let toRefund = 0;
for (const pl of plans) {
  for (const b of pl.bids) {
    bidRows.push({ auction_id: pl.auctionId, bidder_id: b.uid, amount: b.amount, placed_at: daysAgo(rnd(1, 14)) });
  }
  for (const uid of pl.bidders) {
    const released = !pl.live && uid !== pl.winner; // non-winner on ended → to refund
    depRows.push({
      auction_id: pl.auctionId, user_id: uid, amount: Math.round(pl.open * 0.1),
      released_at: released ? daysAgo(rnd(0, 6)) : null,
    });
    if (released) toRefund++;
    if (pl.live && Math.random() < 0.5) {
      entryPayRows.push({
        user_id: uid, auction_id: pl.auctionId, kind: "deposit_lock", provider: pick(["bank_transfer", "d17"]),
        amount: Math.round(pl.open * 0.1), status: "pending_review",
        receipt_uploaded_at: daysAgo(rnd(0, 3)), metadata: { stress: true },
      });
    }
  }
  if (pl.winner && Math.random() < 0.6) {
    entryPayRows.push({
      user_id: pl.winner, auction_id: pl.auctionId, kind: "final_payment", provider: pick(["bank_transfer", "d17"]),
      amount: Math.round(pl.winnerAmount * 0.9), status: "pending_review",
      receipt_uploaded_at: daysAgo(rnd(0, 4)), metadata: { stress: true },
    });
  }
}
for (let i = 0; i < depRows.length; i += 500) await sb.from("auction_deposits").insert(depRows.slice(i, i + 500));
for (let i = 0; i < bidRows.length; i += 500) await sb.from("bids").insert(bidRows.slice(i, i + 500));
for (let i = 0; i < entryPayRows.length; i += 500) await sb.from("payments").insert(entryPayRows.slice(i, i + 500));
console.log(`  ✓ ${aucIds.length} auctions · ${depRows.length} deposits (${toRefund} to refund) · ${bidRows.length} bids · ${entryPayRows.length} entry receipts`);

// ─── 5. seller payouts requested (Paiements vendeurs) ─────────────────────────
console.log("→ Seller payouts…");
const payoutRows = Array.from({ length: 300 }, () => ({
  seller_id: pick(pool), amount: rnd(20, 400) * 1000, status: "requested",
  iban: `TN59 ${rnd(1000, 9999)} ${rnd(1000, 9999)} ${rnd(1000, 9999)} ${rnd(1000, 9999)}`,
  payment_method: "stress",
}));
await sb.from("seller_payouts").insert(payoutRows);
console.log(`  ✓ ${payoutRows.length}`);

// ─── 6. KYC submissions submitted (Personnes · KYC) ───────────────────────────
console.log("→ KYC submissions…");
const kycRows = pool.slice(0, 45).map((uid) => ({
  user_id: uid, full_name: `${MARK} ${pick(FNAMES)} ${pick(LNAMES)}`, status: "submitted",
  submitted_at: daysAgo(rnd(0, 8)),
  id_front_url: "mock/stress/cin-front.jpg", id_back_url: "mock/stress/cin-back.jpg",
  selfie_image_url: "mock/stress/selfie.jpg",
}));
const { error: e6 } = await sb.from("kyc_submissions").upsert(kycRows, { onConflict: "user_id" });
if (e6) console.warn(`  kyc: ${e6.message}`);
else console.log(`  ✓ ${kycRows.length}`);

console.log("\n✅ Stress seed complete. Wipe with: node scripts/seed-admin-stress.mjs --wipe");
