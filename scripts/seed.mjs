// ============================================================================
// Batta.tn — mock data seeder
//
// Idempotent: safe to re-run. Uses the service-role key to bypass RLS so
// it can write across every table. All mock users share the password
// `Batta!2026` so you can log in as any of them from the UI.
//
// Usage:
//   pnpm seed
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LISTINGS } from "./seed-listings.mjs";

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

const PASSWORD = "Batta!2026";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureUser({ email, fullName, phone, role, governorate }) {
  // Try to find an existing user with this email — admin.listUsers is the
  // only paged way; for a small seed we just iterate the first page.
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, role },
    app_metadata: role === "admin" ? { role: "admin" } : undefined,
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  // The DB trigger inserts into profiles, but it can't fully populate role +
  // governorate from app_metadata in all cases — patch explicitly.
  await sb.from("profiles").update({
    full_name: fullName, phone, role, governorate,
    kyc_status: "verified",
    kyc_verified_at: new Date().toISOString(),
    trust_score: 80,
  }).eq("id", data.user.id);
  return data.user.id;
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}
function daysFromNow(d) {
  return new Date(Date.now() + d * 86_400_000).toISOString();
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── 1. Users ───────────────────────────────────────────────────────────────

console.log("→ Creating users…");
const admin = await ensureUser({
  email: "admin@batta.tn", fullName: "محمد الإداري", phone: "+216 71 000 001",
  role: "admin", governorate: "Tunis",
});
const ahmed = await ensureUser({
  email: "ahmed@batta.tn", fullName: "أحمد بن صالح", phone: "+216 22 111 222",
  role: "individual", governorate: "Tunis",
});
const sami = await ensureUser({
  email: "sami@batta.tn", fullName: "سامي التريكي", phone: "+216 50 333 444",
  role: "individual", governorate: "Sousse",
});
const leila = await ensureUser({
  email: "leila@batta.tn", fullName: "ليلى المهيري", phone: "+216 95 555 666",
  role: "individual", governorate: "Sfax",
});
const diaspora = await ensureUser({
  email: "fatma.paris@batta.tn", fullName: "فاطمة من باريس", phone: "+33 6 12 34 56 78",
  role: "individual", governorate: "Tunis",
});
await sb.from("profiles").update({ is_diaspora: true, language: "fr" }).eq("id", diaspora);

const agency = await ensureUser({
  email: "agency@batta.tn", fullName: "Tecnocasa Tunis Centre", phone: "+216 71 100 100",
  role: "agency", governorate: "Tunis",
});
const bank = await ensureUser({
  email: "stb@batta.tn", fullName: "STB · Direction des Recouvrements", phone: "+216 71 340 000",
  role: "bank", governorate: "Tunis",
});
const bailiff = await ensureUser({
  email: "bailiff@batta.tn", fullName: "العدل المنفذ منير الحمدوني", phone: "+216 71 555 777",
  role: "bailiff", governorate: "Tunis",
});

const inspectorIds = [];
for (const i of [
  { email: "insp.tunis@batta.tn", name: "هاجر الزواري", spec: "architect", govs: ["Tunis","Ariana","Ben Arous","Manouba"] },
  { email: "insp.sousse@batta.tn", name: "Karim Ben Salem", spec: "civil_engineer", govs: ["Sousse","Monastir","Mahdia"] },
  { email: "insp.sfax@batta.tn", name: "Mohamed Trabelsi", spec: "real_estate_expert", govs: ["Sfax","Gabès","Médenine"] },
  { email: "insp.nabeul@batta.tn", name: "Mehrez Karoui", spec: "property_lawyer", govs: ["Nabeul","Bizerte","Zaghouan"] },
]) {
  const uid = await ensureUser({
    email: i.email, fullName: i.name, phone: "+216 99 000 " + Math.floor(Math.random() * 900),
    role: "inspector", governorate: i.govs[0],
  });
  await sb.from("inspectors").upsert({
    id: uid, speciality: i.spec, governorates: i.govs, approved: true,
    approved_at: new Date().toISOString(),
    rating_avg: 4.4 + Math.random() * 0.5, rating_count: 12 + Math.floor(Math.random() * 40),
    bio: i.spec === "architect"
      ? "10+ ans d'expérience. Spécialisée dans les bâtiments résidentiels et patrimoniaux."
      : i.spec === "civil_engineer"
        ? "Ingénieur civil agréé. Expertises techniques pour banques et particuliers depuis 2014."
        : i.spec === "real_estate_expert"
          ? "Expert immobilier inscrit au tableau national. Évaluations bancaires."
          : "Avocat spécialisé en droit immobilier et exécution. 15 ans au barreau de Tunis.",
  });
  inspectorIds.push(uid);
}

console.log(`  ✓ ${1 + 4 + 1 + 1 + 1 + inspectorIds.length} users (password: ${PASSWORD})`);

// ─── 2. Properties + photos + documents ─────────────────────────────────────

// We keep the seed-owner list separate from the user IDs so the
// stale-property wipe below knows whose listings to consider.
const SEED_OWNERS = [ahmed, sami, leila, diaspora, agency, bank, bailiff];

// Photos and listing data come from scripts/seed-listings.mjs, which is
// populated by scripts/download-property-images.mjs. Each listing has a
// stable `slug` and one or more local WebP photos under
// /public/properties/<slug>/<n>.webp.

// Owner rotation — each listing index gets one of these owners. Banks
// and bailiffs only own a small handful of "distressed" listings; the
// rest are spread across individuals + the agency.
function ownerForIndex(i) {
  // Specific distressed/judicial listings (indices below) get bank/bailiff:
  //   11 = centre-ville terrain + maison (judicial)
  //   13 = Sidi Mansour km3 promoteur (bank-foreclosure, premium land)
  //   29 = Villa front-mer Sidi Mansour (bank-foreclosure, premium villa)
  if (i === 11) return bailiff;
  if (i === 13 || i === 29) return bank;
  // Agency carries the higher-end villa listings.
  if ([20, 23, 26, 27, 30, 33].includes(i)) return agency;
  // Individuals rotate through the rest.
  const rotation = [ahmed, sami, leila];
  return rotation[i % rotation.length];
}

// Build a description-decorator: distressed listings get a 🏛️/⚖️ prefix
// so they read as bank-foreclosure or judicial sale in the UI without
// needing a separate flag.
function titleForListing(i, base) {
  if (i === 11) return `⚖️ Vente judiciaire · ${base}`;
  if (i === 13 || i === 29) return `🏛️ STB · ${base}`;
  return base;
}
function descForListing(i, base) {
  if (i === 11) return `${base}\n\nVente publique sur exécution. Mise à prix fixée par jugement. Adjudication au plus offrant en audience publique.`;
  if (i === 13 || i === 29) return `${base}\n\nBien adjugé suite à procédure de recouvrement bancaire STB. Toutes garanties juridiques apportées par la banque.`;
  return base;
}

// Generic legal-docs bundle per property type.
function docsForType(t, ownerIdx) {
  // Bank/bailiff listings have more procedural documents on file.
  if (ownerIdx === 11) {
    return ["Jugement d'adjudication", "PV de saisie immobilière", "Rapport d'expertise judiciaire", "Cahier des charges"];
  }
  if (ownerIdx === 13 || ownerIdx === 29) {
    return ["Titre foncier", "PV de saisie", "Acte de prêt original", "Rapport d'expertise"];
  }
  if (t === "land") return ["Titre foncier", "Certificat de bornage", "Permis de lotir"];
  if (t === "villa") return ["Titre foncier", "Permis de bâtir", "Certificat de conformité"];
  return ["Titre foncier", "Certificat de propriété"];
}

// Project a LISTINGS row into the seed-property shape, with owner +
// photo path + decorated title/description applied.
const properties = LISTINGS.map((l, i) => ({
  slug: l.slug,
  owner: ownerForIndex(i),
  title: titleForListing(i, l.title),
  description: descForListing(i, l.description),
  type: l.type,
  area_sqm: l.area_sqm,
  rooms: l.rooms ?? null,
  bathrooms: l.bathrooms ?? null,
  floor: l.type === "apartment" ? (l.floor ?? 0) : null,
  year_built: l.year_built ?? null,
  governorate: l.governorate,
  address: l.address,
  lat: l.lat,
  lng: l.lng,
  // Local optimized WebP — one image per listing for now (the scraper
  // fetched only the cover from tayara). Path resolves to /public/...
  photos: l.images.map((_, idx) => `/properties/${l.slug}/${idx + 1}.webp`),
  docs: docsForType(l.type, i),
  // Stash the listing-quoted asking price so the auction-plan below can
  // pick realistic opening/reserve/sale figures off it.
  askingPrice: l.price,
}));

// Sanity-check that the derived list has the expected shape.
console.log(`  → ${properties.length} listings derived (${properties.filter(p => p.type === "land").length} land, ${properties.filter(p => p.type !== "land").length} house/villa)`);


// Wipe any properties owned by a seed user that aren't in the current
// list — e.g. older mock listings from a prior version of this file.
// Cascade through auctions/bids/deposits/offers/photos/docs/inspections
// so the dataset ends up matching the seed file 1:1.
console.log("→ Wiping stale seed properties from prior runs…");
const currentTitles = new Set(properties.map((p) => p.title));
const { data: existingSeedProps } = await sb
  .from("properties")
  .select("id, title")
  .in("owner_id", SEED_OWNERS);
const staleProps = (existingSeedProps ?? []).filter(
  (p) => !currentTitles.has(p.title),
);
if (staleProps.length > 0) {
  const staleIds = staleProps.map((p) => p.id);
  const { data: staleAucs } = await sb
    .from("auctions").select("id").in("property_id", staleIds);
  const staleAucIds = (staleAucs ?? []).map((a) => a.id);
  if (staleAucIds.length > 0) {
    await sb.from("bids").delete().in("auction_id", staleAucIds);
    await sb.from("auction_deposits").delete().in("auction_id", staleAucIds);
    await sb.from("sixth_offers").delete().in("auction_id", staleAucIds);
    await sb.from("watchlist").delete().in("auction_id", staleAucIds);
    await sb.from("auctions").delete().in("id", staleAucIds);
  }
  await sb.from("inspections").delete().in("property_id", staleIds);
  await sb.from("property_photos").delete().in("property_id", staleIds);
  await sb.from("property_documents").delete().in("property_id", staleIds);
  await sb.from("properties").delete().in("id", staleIds);
  console.log(`  ✓ removed ${staleProps.length} stale properties`);
} else {
  console.log("  ✓ nothing stale to remove");
}

console.log("→ Inserting properties + photos + documents…");
const propertyIds = [];
for (const p of properties) {
  // Idempotent on (owner_id, title) — re-runs update in place.
  const { data: existing } = await sb.from("properties")
    .select("id").eq("owner_id", p.owner).eq("title", p.title).maybeSingle();
  let id = existing?.id;
  if (id) {
    await sb.from("properties").update({
      description: p.description, type: p.type, area_sqm: p.area_sqm,
      rooms: p.rooms, bathrooms: p.bathrooms, floor: p.floor, year_built: p.year_built,
      governorate: p.governorate, address: p.address,
      lat: p.lat, lng: p.lng, status: "ready",
      reviewed_by: admin, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
  } else {
    const { data, error } = await sb.from("properties").insert({
      owner_id: p.owner, title: p.title, description: p.description, type: p.type,
      area_sqm: p.area_sqm, rooms: p.rooms, bathrooms: p.bathrooms,
      floor: p.floor, year_built: p.year_built,
      governorate: p.governorate, address: p.address,
      lat: p.lat, lng: p.lng, status: "ready",
      reviewed_by: admin, reviewed_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(`property insert failed: ${error.message}`);
    id = data.id;
  }
  propertyIds.push({ id, type: p.type, photos: p.photos, docs: p.docs, owner: p.owner });

  // Photos: wipe + reinsert so re-runs reflect any reordering / changes.
  await sb.from("property_photos").delete().eq("property_id", id);
  await sb.from("property_photos").insert(
    p.photos.map((url, i) => ({ property_id: id, storage_path: url, sort_order: i, caption: null })),
  );
  await sb.from("property_documents").delete().eq("property_id", id);
  await sb.from("property_documents").insert(
    p.docs.map((kind) => ({ property_id: id, kind, storage_path: `mock/${id}/${kind}.pdf` })),
  );
}
console.log(`  ✓ ${propertyIds.length} properties`);

// ─── 3. Auctions: live English / Sealed / Dutch + scheduled + ended ─────────

console.log("→ Creating auctions…");

// Wipe and rebuild auctions for our seeded properties so the timing is
// always fresh (live=ends today, scheduled=starts tomorrow, etc).
const propIds = propertyIds.map((p) => p.id);
const { data: existingAuctions } = await sb.from("auctions").select("id").in("property_id", propIds);
if (existingAuctions?.length) {
  const ids = existingAuctions.map((a) => a.id);
  await sb.from("bids").delete().in("auction_id", ids);
  await sb.from("auction_deposits").delete().in("auction_id", ids);
  await sb.from("sixth_offers").delete().in("auction_id", ids);
  await sb.from("watchlist").delete().in("auction_id", ids);
  await sb.from("auctions").delete().in("id", ids);
}

// Each plan row references a propertyIdx into the LISTINGS-derived
// `properties` array above. Mix of live english/sealed/dutch,
// scheduled, ended_sold, direct sales (listing_type='direct' with a
// fixed sale_price), and auctions with a buy_now_price escape hatch.
//
// Tuned so each listing's auction/sale prices stay close to its
// tayara asking price — opening = 75-85%, reserve ≈ ask, buy_now ≈
// 110-120%.
const auctionPlan = [
  // ── 0 · Land Mahres main road — English LIVE, ends in 36h
  { propertyIdx: 0, type: "english", listing_type: "auction",
    opening_price: 230_000, reserve_price: 295_000,
    starts_at: hoursFromNow(-24), ends_at: hoursFromNow(36), status: "live",
    bids: [
      { user: sami,    amount: 230_000 },
      { user: ahmed,   amount: 245_000 },
      { user: diaspora,amount: 260_000, max: 295_000, isProxy: true },
    ],
  },
  // ── 1 · Land Aéroport km10 4942m² — DIRECT SALE négociable
  { propertyIdx: 1, type: "english", listing_type: "direct",
    opening_price: 140_000, sale_price: 140_000, sale_negotiable: true,
    starts_at: hoursFromNow(-72), ends_at: daysFromNow(60), status: "live",
    current_price: 140_000, bids: [],
  },
  // ── 2 · Olive farm Agareb 19ha — Sealed LIVE, premium agricultural
  { propertyIdx: 2, type: "sealed", listing_type: "auction",
    opening_price: 700_000, reserve_price: 850_000,
    starts_at: hoursFromNow(-36), ends_at: daysFromNow(4), status: "live",
    bids: [
      { user: leila,    amount: 720_000 },
      { user: ahmed,    amount: 780_000 },
      { user: diaspora, amount: 820_000 },
    ],
  },
  // ── 3 · Sfax centre-ville terrain — English LIVE + BUY NOW
  { propertyIdx: 3, type: "english", listing_type: "auction",
    opening_price: 240_000, reserve_price: 300_000, buy_now_price: 380_000,
    starts_at: hoursFromNow(-12), ends_at: daysFromNow(2), status: "live",
    bids: [
      { user: ahmed, amount: 240_000 },
      { user: sami,  amount: 255_000 },
    ],
  },
  // ── 4 · Manzel Chaker km18 agricole — DIRECT SALE négociable
  { propertyIdx: 4, type: "english", listing_type: "direct",
    opening_price: 90_000, sale_price: 90_000, sale_negotiable: true,
    starts_at: hoursFromNow(-100), ends_at: daysFromNow(60), status: "live",
    current_price: 90_000, bids: [],
  },
  // ── 5 · Sidi Mansour Sakiet Eddaer — English LIVE, ends in 8h
  { propertyIdx: 5, type: "english", listing_type: "auction",
    opening_price: 20_000, reserve_price: 27_000,
    starts_at: hoursFromNow(-30), ends_at: hoursFromNow(8), status: "live",
    bids: [
      { user: sami,    amount: 20_000 },
      { user: ahmed,   amount: 22_000 },
      { user: leila,   amount: 24_000 },
      { user: diaspora,amount: 26_500, max: 32_000, isProxy: true },
    ],
  },
  // ── 6 · Sakiet Ezzit terrain à bâtir — English LIVE, ends in 18h
  { propertyIdx: 6, type: "english", listing_type: "auction",
    opening_price: 125_000, reserve_price: 150_000,
    starts_at: hoursFromNow(-18), ends_at: hoursFromNow(18), status: "live",
    bids: [
      { user: ahmed, amount: 125_000 },
      { user: leila, amount: 135_000, max: 160_000, isProxy: true },
    ],
  },
  // ── 7 · Teniour km16 13000m² — Sealed LIVE
  { propertyIdx: 7, type: "sealed", listing_type: "auction",
    opening_price: 140_000, reserve_price: 175_000,
    starts_at: hoursFromNow(-24), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: sami,  amount: 145_000 },
      { user: leila, amount: 165_000 },
    ],
  },
  // ── 8 · Route El Ain km7.5 533m² — DIRECT SALE (ferme)
  { propertyIdx: 8, type: "english", listing_type: "direct",
    opening_price: 95_000, sale_price: 95_000, sale_negotiable: false,
    starts_at: hoursFromNow(-50), ends_at: daysFromNow(45), status: "live",
    current_price: 95_000, bids: [],
  },
  // ── 9 · El Hencha agricole — DIRECT SALE négociable
  { propertyIdx: 9, type: "english", listing_type: "direct",
    opening_price: 150_000, sale_price: 150_000, sale_negotiable: true,
    starts_at: hoursFromNow(-200), ends_at: daysFromNow(75), status: "live",
    current_price: 150_000, bids: [],
  },
  // ── 10 · Sidi Abdelkafi deux lots — English ENDED & SOLD
  { propertyIdx: 10, type: "english", listing_type: "auction",
    opening_price: 12_000, reserve_price: 16_000,
    starts_at: daysFromNow(-18), ends_at: daysFromNow(-11), status: "ended_sold",
    winner_user_id: sami, winner_amount: 18_500, hammer_at: daysFromNow(-11),
    current_price: 18_500,
    bids: [
      { user: ahmed, amount: 12_000 },
      { user: leila, amount: 14_500 },
      { user: sami,  amount: 18_500, max: 22_000 },
    ],
  },
  // ── 11 · ⚖️ Bailiff judicial — Centre terrain+maison — English LIVE
  { propertyIdx: 11, type: "english", listing_type: "auction",
    opening_price: 285_000, reserve_price: null,
    starts_at: hoursFromNow(-48), ends_at: hoursFromNow(48), status: "live",
    bids: [
      { user: sami,  amount: 285_000 },
      { user: leila, amount: 305_000 },
      { user: ahmed, amount: 320_000 },
    ],
  },
  // ── 12 · Menzel Chaker terrain — English SCHEDULED, opens in 2d
  { propertyIdx: 12, type: "english", listing_type: "auction",
    opening_price: 105_000, reserve_price: 130_000,
    starts_at: daysFromNow(2), ends_at: daysFromNow(9), status: "scheduled",
    bids: [],
  },
  // ── 13 · 🏛️ STB · Sidi Mansour km3 promoteur — Sealed LIVE, premium land
  { propertyIdx: 13, type: "sealed", listing_type: "auction",
    opening_price: 700_000, reserve_price: 850_000,
    starts_at: hoursFromNow(-30), ends_at: daysFromNow(5), status: "live",
    bids: [
      { user: ahmed,    amount: 720_000 },
      { user: agency,   amount: 780_000 },
      { user: diaspora, amount: 820_000 },
    ],
  },
  // ── 14 · Route El Afrane terrain — DIRECT SALE négociable
  { propertyIdx: 14, type: "english", listing_type: "direct",
    opening_price: 280_000, sale_price: 280_000, sale_negotiable: true,
    starts_at: hoursFromNow(-90), ends_at: daysFromNow(60), status: "live",
    current_price: 280_000, bids: [],
  },
  // ── 15 · Route Tunis lotissement — DIRECT SALE (ferme, prix unitaire)
  { propertyIdx: 15, type: "english", listing_type: "direct",
    opening_price: 35_000, sale_price: 35_000, sale_negotiable: false,
    starts_at: hoursFromNow(-150), ends_at: daysFromNow(90), status: "live",
    current_price: 35_000, bids: [],
  },
  // ── 16 · Route Gabes km2.5 — English LIVE + BUY NOW
  { propertyIdx: 16, type: "english", listing_type: "auction",
    opening_price: 390_000, reserve_price: 475_000, buy_now_price: 550_000,
    starts_at: hoursFromNow(-12), ends_at: daysFromNow(4), status: "live",
    bids: [
      { user: leila,    amount: 390_000 },
      { user: ahmed,    amount: 415_000 },
      { user: diaspora, amount: 440_000, max: 510_000, isProxy: true },
    ],
  },
  // ── 17 · Teniour km21 — English LIVE, ends in 12h
  { propertyIdx: 17, type: "english", listing_type: "auction",
    opening_price: 80_000, reserve_price: 100_000,
    starts_at: hoursFromNow(-24), ends_at: hoursFromNow(12), status: "live",
    bids: [
      { user: sami,  amount: 80_000 },
      { user: ahmed, amount: 90_000 },
      { user: leila, amount: 96_000 },
    ],
  },
  // ── 18 · Teniour km15 route principale — English SCHEDULED
  { propertyIdx: 18, type: "english", listing_type: "auction",
    opening_price: 340_000, reserve_price: 420_000,
    starts_at: daysFromNow(3), ends_at: daysFromNow(10), status: "scheduled",
    bids: [],
  },
  // ── 19 · Route Gremda km13 — English LIVE
  { propertyIdx: 19, type: "english", listing_type: "auction",
    opening_price: 175_000, reserve_price: 220_000,
    starts_at: hoursFromNow(-20), ends_at: daysFromNow(2), status: "live",
    bids: [
      { user: ahmed, amount: 175_000 },
      { user: sami,  amount: 195_000 },
    ],
  },
  // ── 20 · Villa El Ain/Afrane 1684m² — English LIVE, hot bidding
  { propertyIdx: 20, type: "english", listing_type: "auction",
    opening_price: 700_000, reserve_price: 800_000,
    starts_at: hoursFromNow(-48), ends_at: hoursFromNow(60), status: "live",
    bids: [
      { user: sami,    amount: 700_000 },
      { user: ahmed,   amount: 730_000 },
      { user: leila,   amount: 760_000 },
      { user: diaspora,amount: 790_000, max: 880_000, isProxy: true },
    ],
  },
  // ── 21 · Kerkennah maison + garage — DIRECT SALE (ferme)
  { propertyIdx: 21, type: "english", listing_type: "direct",
    opening_price: 125_000, sale_price: 125_000, sale_negotiable: false,
    starts_at: hoursFromNow(-72), ends_at: daysFromNow(50), status: "live",
    current_price: 125_000, bids: [],
  },
  // ── 22 · Kerkennah vue mer Charqui — English LIVE
  { propertyIdx: 22, type: "english", listing_type: "auction",
    opening_price: 105_000, reserve_price: 130_000,
    starts_at: hoursFromNow(-15), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: leila, amount: 105_000 },
      { user: ahmed, amount: 115_000, max: 140_000, isProxy: true },
    ],
  },
  // ── 23 · Villa charme Saltania — English LIVE + proxy battle
  { propertyIdx: 23, type: "english", listing_type: "auction",
    opening_price: 380_000, reserve_price: 445_000,
    starts_at: hoursFromNow(-24), ends_at: daysFromNow(2), status: "live",
    bids: [
      { user: ahmed,    amount: 380_000 },
      { user: leila,    amount: 405_000 },
      { user: diaspora, amount: 420_000, max: 480_000, isProxy: true },
    ],
  },
  // ── 24 · Bounouma pieds dans l'eau — Sealed LIVE, premium villa
  { propertyIdx: 24, type: "sealed", listing_type: "auction",
    opening_price: 820_000, reserve_price: 950_000,
    starts_at: hoursFromNow(-12), ends_at: daysFromNow(6), status: "live",
    bids: [
      { user: ahmed,    amount: 850_000 },
      { user: diaspora, amount: 910_000 },
    ],
  },
  // ── 25 · Villa Sidi Mansour — English ENDED & SOLD (recent)
  { propertyIdx: 25, type: "english", listing_type: "auction",
    opening_price: 310_000, reserve_price: 370_000,
    starts_at: daysFromNow(-20), ends_at: daysFromNow(-13), status: "ended_sold",
    winner_user_id: diaspora, winner_amount: 395_000, hammer_at: daysFromNow(-13),
    current_price: 395_000,
    bids: [
      { user: ahmed,    amount: 310_000 },
      { user: leila,    amount: 350_000 },
      { user: diaspora, amount: 395_000, max: 425_000 },
    ],
  },
  // ── 26 · Villa Route Taniour km2.5 — English LIVE
  { propertyIdx: 26, type: "english", listing_type: "auction",
    opening_price: 620_000, reserve_price: 720_000,
    starts_at: hoursFromNow(-30), ends_at: daysFromNow(2), status: "live",
    bids: [
      { user: ahmed, amount: 620_000 },
      { user: sami,  amount: 660_000 },
      { user: leila, amount: 685_000 },
    ],
  },
  // ── 27 · Villa Bouzayen km8 — English SCHEDULED
  { propertyIdx: 27, type: "english", listing_type: "auction",
    opening_price: 660_000, reserve_price: 775_000,
    starts_at: daysFromNow(4), ends_at: daysFromNow(11), status: "scheduled",
    bids: [],
  },
  // ── 28 · Villa Teniour km3 — DIRECT SALE négociable
  { propertyIdx: 28, type: "english", listing_type: "direct",
    opening_price: 375_000, sale_price: 375_000, sale_negotiable: true,
    starts_at: hoursFromNow(-100), ends_at: daysFromNow(60), status: "live",
    current_price: 375_000, bids: [],
  },
  // ── 29 · 🏛️ STB Villa Front mer — English LIVE, premium bank-sale
  { propertyIdx: 29, type: "english", listing_type: "auction",
    opening_price: 950_000, reserve_price: 1_100_000,
    starts_at: hoursFromNow(-36), ends_at: daysFromNow(4), status: "live",
    bids: [
      { user: ahmed,    amount: 950_000 },
      { user: diaspora, amount: 1_005_000, max: 1_180_000, isProxy: true },
      { user: leila,    amount: 1_040_000 },
    ],
  },
  // ── 30 · Villa Cité Essaada Soukra — English SCHEDULED
  { propertyIdx: 30, type: "english", listing_type: "auction",
    opening_price: 520_000, reserve_price: 600_000,
    starts_at: daysFromNow(5), ends_at: daysFromNow(12), status: "scheduled",
    bids: [],
  },
  // ── 31 · Villa style américain Route Gabes — DIRECT SALE (ferme)
  { propertyIdx: 31, type: "english", listing_type: "direct",
    opening_price: 350_000, sale_price: 350_000, sale_negotiable: false,
    starts_at: hoursFromNow(-80), ends_at: daysFromNow(45), status: "live",
    current_price: 350_000, bids: [],
  },
  // ── 32 · Villa Route Mahdia km4 — Dutch LIVE (450k → 290k tick-down)
  { propertyIdx: 32, type: "dutch", listing_type: "auction",
    opening_price: 290_000,
    dutch_start_price: 450_000, dutch_floor_price: 290_000,
    dutch_decrement: 5_000, dutch_tick_seconds: 3600, // -5k/hr
    starts_at: hoursFromNow(-4), ends_at: hoursFromNow(60), status: "live",
    bids: [],
  },
  // ── 33 · Villa neuve Lafrane km4.5 — English LIVE + BUY NOW
  { propertyIdx: 33, type: "english", listing_type: "auction",
    opening_price: 400_000, reserve_price: 480_000, buy_now_price: 580_000,
    starts_at: hoursFromNow(-18), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: sami,    amount: 400_000 },
      { user: diaspora,amount: 430_000, max: 520_000, isProxy: true },
    ],
  },
  // ── 34 · Villa 1100m² Sakiet Ezzit — English LIVE
  { propertyIdx: 34, type: "english", listing_type: "auction",
    opening_price: 450_000, reserve_price: 540_000,
    starts_at: hoursFromNow(-20), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: ahmed, amount: 450_000 },
      { user: leila, amount: 480_000 },
      { user: sami,  amount: 510_000 },
    ],
  },
  // ── 35 · Maison Route Mahdia km10 — English ENDED & SOLD
  { propertyIdx: 35, type: "english", listing_type: "auction",
    opening_price: 120_000, reserve_price: 155_000,
    starts_at: daysFromNow(-25), ends_at: daysFromNow(-18), status: "ended_sold",
    winner_user_id: ahmed, winner_amount: 172_000, hammer_at: daysFromNow(-18),
    current_price: 172_000,
    bids: [
      { user: leila,    amount: 120_000 },
      { user: sami,     amount: 145_000 },
      { user: ahmed,    amount: 172_000, max: 195_000 },
    ],
  },
];

let createdAuctions = 0;
let createdBids = 0;
let createdDeposits = 0;
for (const plan of auctionPlan) {
  const property = propertyIds[plan.propertyIdx];
  if (!property) continue;

  const auctionRow = {
    property_id: property.id,
    type: plan.type,
    listing_type: plan.listing_type ?? "auction",
    opening_price: plan.opening_price,
    reserve_price: plan.reserve_price ?? null,
    sale_price: plan.sale_price ?? null,
    sale_negotiable: plan.sale_negotiable ?? false,
    buy_now_price: plan.buy_now_price ?? null,
    dutch_start_price: plan.dutch_start_price ?? null,
    dutch_floor_price: plan.dutch_floor_price ?? null,
    dutch_decrement: plan.dutch_decrement ?? null,
    dutch_tick_seconds: plan.dutch_tick_seconds ?? null,
    starts_at: plan.starts_at,
    ends_at: plan.ends_at,
    status: plan.status,
    current_price: plan.bids.length
      ? Math.max(...plan.bids.map((b) => b.amount))
      : (plan.current_price ?? plan.opening_price),
    winner_user_id: plan.winner_user_id ?? null,
    winner_amount: plan.winner_amount ?? null,
    hammer_at: plan.hammer_at ?? null,
  };
  const { data: a, error } = await sb.from("auctions").insert(auctionRow).select("id").single();
  if (error) throw new Error(`auction insert failed: ${error.message}`);
  createdAuctions++;

  // Deposits + bids: every distinct bidder gets one deposit row, then we
  // insert bids in chronological order (oldest first) so the natural
  // realtime ordering matches the seed intent.
  const distinctBidders = [...new Set(plan.bids.map((b) => b.user))];
  for (const uid of distinctBidders) {
    await sb.from("auction_deposits").insert({
      auction_id: a.id, user_id: uid,
      amount: Math.round(plan.opening_price * 0.1),
      released_at: plan.status === "ended_sold" && uid !== plan.winner_user_id ? new Date().toISOString() : null,
    });
    createdDeposits++;
  }

  let when = new Date(plan.starts_at).getTime() + 60_000;
  for (const b of plan.bids) {
    await sb.from("bids").insert({
      auction_id: a.id, bidder_id: b.user, amount: b.amount,
      max_amount: b.max ?? null, is_proxy: !!b.isProxy,
      placed_at: new Date(when).toISOString(),
    });
    createdBids++;
    when += 60_000 + Math.floor(Math.random() * 1_800_000); // 1 to 31 min apart
  }
}
console.log(`  ✓ ${createdAuctions} auctions, ${createdBids} bids, ${createdDeposits} deposits`);

// ─── 4. Inspections — a few completed, a few scheduled ──────────────────────

console.log("→ Creating inspections…");
await sb.from("inspections").delete().in("requested_by", [ahmed, sami, leila, diaspora]);
const inspections = [
  // All inspectors are Sfax-area, so route inspections to the Sfax
  // inspector (index 2) for most jobs; the architect (0) handles the
  // high-value bank villa and the agricultural engineer (1) takes the
  // ferme + the rural plots. Lawyer (3) covers judicial sales.
  { property: propertyIds[2].id,  requestedBy: ahmed,    inspector: inspectorIds[2], kind: "standard",     scheduled_at: daysFromNow(2),  status: "scheduled", fee: 400 },                                                  // Agareb 19ha olive farm
  { property: propertyIds[11].id, requestedBy: leila,    inspector: inspectorIds[3], kind: "full",         scheduled_at: daysFromNow(-3), status: "approved",  fee: 750, report: "mock/reports/sfax-judicial.pdf" },         // Judicial centre-ville
  { property: propertyIds[13].id, requestedBy: diaspora, inspector: inspectorIds[0], kind: "full",         scheduled_at: daysFromNow(1),  status: "scheduled", fee: 900 },                                                  // STB Sidi Mansour km3
  { property: propertyIds[20].id, requestedBy: ahmed,    inspector: inspectorIds[2], kind: "full",         scheduled_at: daysFromNow(4),  status: "requested", fee: 700 },                                                  // Villa 1684m El Ain
  { property: propertyIds[23].id, requestedBy: leila,    inspector: inspectorIds[2], kind: "standard",     scheduled_at: daysFromNow(-7), status: "approved",  fee: 350, report: "mock/reports/villa-saltania.pdf" },        // Villa Saltania
  { property: propertyIds[24].id, requestedBy: diaspora, inspector: inspectorIds[0], kind: "virtual_live", scheduled_at: daysFromNow(3),  status: "scheduled", fee: 450 },                                                  // Bounouma pieds-eau
  { property: propertyIds[29].id, requestedBy: diaspora, inspector: inspectorIds[0], kind: "full",         scheduled_at: daysFromNow(-1), status: "approved",  fee: 1100, report: "mock/reports/villa-front-mer.pdf" },      // STB Villa Front mer
  { property: propertyIds[33].id, requestedBy: sami,     inspector: inspectorIds[2], kind: "standard",     scheduled_at: daysFromNow(-4), status: "approved",  fee: 350, report: "mock/reports/villa-lafrane.pdf" },         // Villa neuve Lafrane
];
for (const ins of inspections) {
  await sb.from("inspections").insert({
    property_id: ins.property, requested_by: ins.requestedBy, inspector_id: ins.inspector,
    kind: ins.kind, scheduled_at: ins.scheduled_at, status: ins.status,
    fee_amount: ins.fee, report_pdf_path: ins.report ?? null,
  });
}
console.log(`  ✓ ${inspections.length} inspections`);

// ─── 5. Payments — historical commission + deposit + inspection fees ────────

console.log("→ Creating payments…");
await sb.from("payments").delete().in("user_id", [ahmed, sami, leila, diaspora]);
const payments = [
  { user: diaspora, kind: "deposit_lock",  provider: "bank_transfer", amount: 9_500,  status: "captured" },
  { user: ahmed,    kind: "deposit_lock",  provider: "d17",           amount: 38_000, status: "captured" },
  { user: leila,    kind: "deposit_lock",  provider: "bank_transfer", amount: 22_000, status: "captured" },
  { user: diaspora, kind: "commission",    provider: "bank_transfer", amount: 1_280,  status: "captured" }, // 1% of 128k sale
  { user: ahmed,    kind: "inspection_fee",provider: "d17",           amount: 700,    status: "captured" },
  { user: leila,    kind: "inspection_fee",provider: "bank_transfer", amount: 600,    status: "captured" },
  { user: agency,   kind: "subscription",  provider: "bank_transfer", amount: 299,    status: "captured" }, // Pro tier
];
for (const p of payments) {
  await sb.from("payments").insert({
    user_id: p.user, kind: p.kind, provider: p.provider,
    amount: p.amount, status: p.status,
    metadata: { mock: true, captured_at: new Date().toISOString() },
  });
}
console.log(`  ✓ ${payments.length} payments`);

// ─── 6. Waitlist — a handful of plausible early signups ─────────────────────

console.log("→ Adding waitlist entries…");
const waitlist = [
  { email: "investor.gulf@example.com",   phone: "+971 50 123 4567", locale: "en", source: "linkedin" },
  { email: "expat.lyon@example.com",      phone: "+33 6 78 90 12 34", locale: "fr", source: "facebook" },
  { email: "agence.sousse@example.com",   phone: "+216 73 200 100",  locale: "fr", source: "referral" },
  { email: "first.time.buyer@example.com",phone: "+216 22 444 555",  locale: "ar", source: "tiktok" },
  { email: "huissier.sfax@example.com",   phone: "+216 74 300 200",  locale: "ar", source: "direct" },
];
for (const w of waitlist) {
  await sb.from("waitlist").upsert(w, { onConflict: "email" });
}
console.log(`  ✓ ${waitlist.length} waitlist signups`);

console.log("");
console.log("✅ Seed complete.");
console.log("");
console.log("Login credentials (password for everyone): " + PASSWORD);
console.log("  admin@batta.tn         — admin dashboard");
console.log("  ahmed@batta.tn         — bidder/seller (Tunis)");
console.log("  sami@batta.tn          — bidder/seller (Sousse)");
console.log("  leila@batta.tn         — bidder/seller (Sfax)");
console.log("  fatma.paris@batta.tn   — diaspora bidder (FR)");
console.log("  agency@batta.tn        — Tecnocasa agency");
console.log("  stb@batta.tn           — STB bank (distressed assets)");
console.log("  bailiff@batta.tn       — court bailiff");
console.log("  insp.tunis@batta.tn    — inspector (Tunis area)");
console.log("");
