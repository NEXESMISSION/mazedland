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

// Real-estate stock photos from Unsplash (whitelisted in next.config.ts CSP).
const HOUSE = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80";
const APT_LIVING = "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80";
const APT_KITCHEN = "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80";
const VILLA = "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80";
const VILLA_POOL = "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80";
const LAND = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80";
const COMMERCIAL = "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80";
const OFFICE = "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1200&q=80";

const properties = [
  {
    owner: ahmed,
    title: "شقة S+2 مفروشة بالكامل · المنزه 6",
    description: "شقة فاخرة بتشطيبات حديثة، تطل على حديقة عمومية. مصعد، موقف سيارة خاص، قريبة من المدارس والمواصلات. ملف قانوني سليم 100%.",
    type: "apartment", area_sqm: 105, rooms: 3, bathrooms: 2, floor: 4, year_built: 2018,
    governorate: "Tunis", delegation: "Le Manzah", address: "Rue Ibn Khaldoun, El Manzah 6",
    lat: 36.852, lng: 10.150,
    photos: [APT_LIVING, APT_KITCHEN, HOUSE],
    docs: ["Titre foncier", "Certificat de propriété", "Plan de situation"],
  },
  {
    owner: leila,
    title: "Villa avec piscine · Hammamet Sud",
    description: "Villa de standing 280 m² sur terrain de 600 m². 4 chambres, double salon, cuisine équipée, piscine 8x4, garage 2 voitures. Vue mer indirecte. Quartier résidentiel calme.",
    type: "villa", area_sqm: 280, rooms: 4, bathrooms: 3, floor: 0, year_built: 2015,
    governorate: "Nabeul", delegation: "Hammamet", address: "Route touristique, Hammamet Sud",
    lat: 36.378, lng: 10.563,
    photos: [VILLA, VILLA_POOL, HOUSE],
    docs: ["Titre foncier", "Permis de bâtir", "Quitus fiscal"],
  },
  {
    owner: sami,
    title: "Appartement S+1 · Centre-ville Sousse",
    description: "À 5 minutes à pied de la médina. Bien rénové en 2023. Idéal investissement locatif (tourisme). Charges réduites.",
    type: "apartment", area_sqm: 65, rooms: 2, bathrooms: 1, floor: 3, year_built: 1995,
    governorate: "Sousse", delegation: "Sousse Médina", address: "Avenue Habib Bourguiba, Sousse",
    lat: 35.8256, lng: 10.6411,
    photos: [APT_LIVING, APT_KITCHEN],
    docs: ["Titre foncier", "Quittance fonctionnaire"],
  },
  {
    owner: bank,
    title: "🏛️ STB · Local commercial 220m² · Lac 2",
    description: "Local commercial situé au rez-de-chaussée d'un immeuble standing. Idéal restaurant, bureau ou showroom. Mise à prix sous valeur de marché — bien adjugé suite procédure de saisie.",
    type: "commercial", area_sqm: 220, rooms: null, bathrooms: 2, floor: 0, year_built: 2010,
    governorate: "Tunis", delegation: "Les Berges du Lac", address: "Rue du Lac Lochness, Lac 2",
    lat: 36.842, lng: 10.265,
    photos: [COMMERCIAL, OFFICE],
    docs: ["Titre foncier", "PV de saisie", "Rapport d'expertise judiciaire"],
  },
  {
    owner: bank,
    title: "🏛️ STB · Villa duplex 320m² · La Marsa Plage",
    description: "Villa duplex sur 2 niveaux, terrain 480m². Bien adjugé suite procédure de recouvrement. Vente à la barre — toutes garanties bancaires.",
    type: "villa", area_sqm: 320, rooms: 5, bathrooms: 4, floor: 0, year_built: 2008,
    governorate: "Tunis", delegation: "La Marsa", address: "Rue de la Plage, La Marsa Plage",
    lat: 36.886, lng: 10.323,
    photos: [VILLA, HOUSE, VILLA_POOL],
    docs: ["Titre foncier", "PV de saisie", "Acte de prêt original", "Rapport d'expertise"],
  },
  {
    owner: agency,
    title: "Appartement haut standing S+3 · Les Jardins de Carthage",
    description: "Vendu par Tecnocasa. Résidence sécurisée, ascenseur, parking sous-sol. Belle exposition Sud-Ouest, grand balcon. Dossier impeccable.",
    type: "apartment", area_sqm: 145, rooms: 4, bathrooms: 2, floor: 2, year_built: 2020,
    governorate: "Tunis", delegation: "Carthage", address: "Les Jardins de Carthage",
    lat: 36.857, lng: 10.323,
    photos: [APT_LIVING, APT_KITCHEN, HOUSE],
    docs: ["Titre foncier", "Règlement de copropriété", "Certificat de propriété"],
  },
  {
    owner: agency,
    title: "Bureau professionnel 90m² · Sfax Centre",
    description: "Bureau au 1er étage, idéal cabinet médical, avocat, ou expert-comptable. Ascenseur, climatisation centrale, parking visiteurs.",
    type: "office", area_sqm: 90, rooms: 4, bathrooms: 1, floor: 1, year_built: 2017,
    governorate: "Sfax", delegation: "Sfax Médina", address: "Avenue Ali Belhouane, Sfax",
    lat: 34.7398, lng: 10.7600,
    photos: [OFFICE, COMMERCIAL],
    docs: ["Titre foncier", "Permis d'usage commercial"],
  },
  {
    owner: bailiff,
    title: "⚖️ Vente judiciaire · Maison R+1 · Bizerte",
    description: "Maison de ville sur 2 niveaux, vente publique sur exécution. Mise à prix fixée par jugement n° 2025/4521.",
    type: "house", area_sqm: 180, rooms: 4, bathrooms: 2, floor: 0, year_built: 2000,
    governorate: "Bizerte", delegation: "Bizerte Nord", address: "Rue de la République, Bizerte",
    lat: 37.272, lng: 9.873,
    photos: [HOUSE, APT_LIVING],
    docs: ["Jugement d'adjudication", "PV de saisie immobilière", "Rapport d'expertise judiciaire"],
  },
  {
    owner: leila,
    title: "أرض بناء 800m² · حي السلام · صفاقس",
    description: "أرض جاهزة للبناء، مقسمة، مع شهادة تخطيط. مستوية، تطل على شارعين. مناسبة لفيلا أو عمارة سكنية.",
    type: "land", area_sqm: 800, rooms: null, bathrooms: null, floor: null, year_built: null,
    governorate: "Sfax", delegation: "El Salam", address: "حي السلام, صفاقس",
    lat: 34.728, lng: 10.762,
    photos: [LAND],
    docs: ["Titre foncier", "Certificat de bornage", "Permis de lotir"],
  },
  {
    owner: ahmed,
    title: "Studio S+0 meublé · La Goulette",
    description: "Studio entièrement meublé et équipé, à 100m de la plage. Idéal investissement Airbnb / location courte durée. Vendu meublé.",
    type: "apartment", area_sqm: 38, rooms: 1, bathrooms: 1, floor: 2, year_built: 2012,
    governorate: "Tunis", delegation: "La Goulette", address: "Rue de la Plage, La Goulette",
    lat: 36.819, lng: 10.305,
    photos: [APT_LIVING, APT_KITCHEN],
    docs: ["Titre foncier", "Inventaire mobilier"],
  },
];

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
      governorate: p.governorate, delegation: p.delegation, address: p.address,
      lat: p.lat, lng: p.lng, status: "ready",
      reviewed_by: admin, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
  } else {
    const { data, error } = await sb.from("properties").insert({
      owner_id: p.owner, title: p.title, description: p.description, type: p.type,
      area_sqm: p.area_sqm, rooms: p.rooms, bathrooms: p.bathrooms,
      floor: p.floor, year_built: p.year_built,
      governorate: p.governorate, delegation: p.delegation, address: p.address,
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
  await sb.from("auctions").delete().in("auction_id", ids);
  // ^ probable typo guard: filter is `in("id", ids)` for the parent table
  await sb.from("auctions").delete().in("id", ids);
}

const auctionPlan = [
  // English LIVE — ends in 6h, will get bids
  { propertyIdx: 0, type: "english", opening_price: 380_000, reserve_price: 410_000,
    starts_at: hoursFromNow(-48), ends_at: hoursFromNow(6), status: "live",
    bids: [
      { user: sami,    amount: 380_000, max: 395_000 },
      { user: leila,   amount: 385_000, max: 405_000, isProxy: true },
      { user: ahmed,   amount: 390_000, max: 420_000 },
      { user: sami,    amount: 395_000 },
      { user: diaspora,amount: 400_000, max: 440_000 },
      { user: ahmed,   amount: 405_000 },
    ],
  },
  // English LIVE — ends in 22h, fewer bids
  { propertyIdx: 1, type: "english", opening_price: 1_200_000, reserve_price: 1_350_000,
    starts_at: hoursFromNow(-12), ends_at: hoursFromNow(22), status: "live",
    bids: [
      { user: leila,    amount: 1_200_000 },
      { user: diaspora, amount: 1_210_000, max: 1_280_000, isProxy: true },
    ],
  },
  // Sealed-bid LIVE — ends in 3 days
  { propertyIdx: 2, type: "sealed", opening_price: 220_000, reserve_price: 240_000,
    starts_at: hoursFromNow(-24), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: ahmed,    amount: 235_000 },
      { user: leila,    amount: 248_000 },
      { user: diaspora, amount: 261_000 },
    ],
  },
  // Bank Dutch LIVE — ticks down from 480k toward 400k
  { propertyIdx: 3, type: "dutch", opening_price: 400_000,
    dutch_start_price: 480_000, dutch_floor_price: 400_000,
    dutch_decrement: 5_000, dutch_tick_seconds: 1800, // -5k every 30 min
    starts_at: hoursFromNow(-2), ends_at: hoursFromNow(28), status: "live",
    bids: [],
  },
  // Bank English LIVE — high-value
  { propertyIdx: 4, type: "english", opening_price: 850_000, reserve_price: 920_000,
    starts_at: hoursFromNow(-6), ends_at: hoursFromNow(48), status: "live",
    bids: [
      { user: ahmed,    amount: 850_000 },
      { user: leila,    amount: 870_000 },
      { user: diaspora, amount: 900_000, max: 1_000_000, isProxy: true },
    ],
  },
  // Agency English SCHEDULED — opens in 2 days
  { propertyIdx: 5, type: "english", opening_price: 520_000, reserve_price: 580_000,
    starts_at: daysFromNow(2), ends_at: daysFromNow(9), status: "scheduled",
    bids: [],
  },
  // Sealed-bid SCHEDULED
  { propertyIdx: 6, type: "sealed", opening_price: 280_000,
    starts_at: daysFromNow(1), ends_at: daysFromNow(8), status: "scheduled",
    bids: [],
  },
  // Bailiff English LIVE — judicial sale
  { propertyIdx: 7, type: "english", opening_price: 310_000, reserve_price: null,
    starts_at: hoursFromNow(-72), ends_at: hoursFromNow(48), status: "live",
    bids: [
      { user: sami, amount: 310_000 },
      { user: leila, amount: 320_000 },
    ],
  },
  // Land — Sealed scheduled
  { propertyIdx: 8, type: "sealed", opening_price: 180_000,
    starts_at: daysFromNow(3), ends_at: daysFromNow(10), status: "scheduled",
    bids: [],
  },
  // Studio English ENDED & sold (last week)
  { propertyIdx: 9, type: "english", opening_price: 95_000, reserve_price: 110_000,
    starts_at: daysFromNow(-14), ends_at: daysFromNow(-7), status: "ended_sold",
    winner_user_id: diaspora, winner_amount: 128_000, hammer_at: daysFromNow(-7),
    current_price: 128_000,
    bids: [
      { user: ahmed,    amount: 95_000 },
      { user: leila,    amount: 105_000 },
      { user: diaspora, amount: 128_000, max: 150_000 },
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
    opening_price: plan.opening_price,
    reserve_price: plan.reserve_price ?? null,
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
  { property: propertyIds[0].id, requestedBy: diaspora, inspector: inspectorIds[0], kind: "virtual_live", scheduled_at: daysFromNow(2), status: "scheduled", fee: 350 },
  { property: propertyIds[1].id, requestedBy: leila,    inspector: inspectorIds[3], kind: "full",         scheduled_at: daysFromNow(-3), status: "approved", fee: 600, report: "mock/reports/villa-hammamet.pdf" },
  { property: propertyIds[2].id, requestedBy: ahmed,    inspector: inspectorIds[1], kind: "standard",     scheduled_at: daysFromNow(-7), status: "approved", fee: 250, report: "mock/reports/sousse-apt.pdf" },
  { property: propertyIds[3].id, requestedBy: ahmed,    inspector: inspectorIds[0], kind: "full",         scheduled_at: daysFromNow(1),  status: "scheduled", fee: 700 },
  { property: propertyIds[5].id, requestedBy: diaspora, inspector: inspectorIds[0], kind: "virtual_live", scheduled_at: daysFromNow(4),  status: "requested", fee: 400 },
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
  { user: diaspora, kind: "deposit_lock",  provider: "konnect", amount: 9_500,  status: "captured" },
  { user: ahmed,    kind: "deposit_lock",  provider: "paymee",  amount: 38_000, status: "captured" },
  { user: leila,    kind: "deposit_lock",  provider: "konnect", amount: 22_000, status: "captured" },
  { user: diaspora, kind: "commission",    provider: "konnect", amount: 1_280,  status: "captured" }, // 1% of 128k sale
  { user: ahmed,    kind: "inspection_fee",provider: "flouci",  amount: 700,    status: "captured" },
  { user: leila,    kind: "inspection_fee",provider: "konnect", amount: 600,    status: "captured" },
  { user: agency,   kind: "subscription",  provider: "paymee",  amount: 299,    status: "captured" }, // Pro tier
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
