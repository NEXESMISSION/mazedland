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

// We keep the seed-owner list separate from the user IDs so the
// stale-property wipe below knows whose listings to consider.
const SEED_OWNERS = [ahmed, sami, leila, diaspora, agency, bank, bailiff];

// Real-estate stock photos from Unsplash (whitelisted in next.config.ts CSP).
// Image pool — curated Unsplash URLs covering the property types we
// list. All free + properly licensed (Unsplash license). Hosted on
// images.unsplash.com which is whitelisted in next.config.ts so
// Next/Image's optimizer can resize + serve WebP/AVIF on demand.
const HOUSE       = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1600&q=80";
const HOUSE_2     = "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1600&q=80";
const HOUSE_3     = "https://images.unsplash.com/photo-1605114589013-92e842e72cce?w=1600&q=80";
const APT_LIVING  = "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1600&q=80";
const APT_KITCHEN = "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1600&q=80";
const APT_LIVING_2 = "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1600&q=80";
const BEDROOM     = "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1600&q=80";
const BATHROOM    = "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=1600&q=80";
const VILLA       = "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1600&q=80";
const VILLA_POOL  = "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1600&q=80";
const VILLA_MED   = "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1600&q=80";
const TERRACE     = "https://images.unsplash.com/photo-1600210492493-0946911123ea?w=1600&q=80";
const LAND        = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1600&q=80";
const LAND_OLIVE  = "https://images.unsplash.com/photo-1568043210943-0e8c7e8e2e1a?w=1600&q=80";
const LAND_AGRI   = "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=1600&q=80";
const COMMERCIAL  = "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80";
const OFFICE      = "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1600&q=80";
const OFFICE_2    = "https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1600&q=80";
const SHOP        = "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1600&q=80";
const BEACH_VIEW  = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80";
const COURTYARD   = "https://images.unsplash.com/photo-1601760561441-16420502c7e0?w=1600&q=80";

const properties = [
  // ─── TUNIS — 12 listings (premium market) ─────────────────────────────────
  {
    owner: ahmed,
    title: "شقة S+2 مفروشة بالكامل · المنزه 6",
    description: "شقة فاخرة بتشطيبات حديثة، تطل على حديقة عمومية. مصعد، موقف سيارة خاص، قريبة من المدارس والمواصلات. ملف قانوني سليم 100%.",
    type: "apartment", area_sqm: 105, rooms: 3, bathrooms: 2, floor: 4, year_built: 2018,
    governorate: "Tunis", delegation: "Le Manzah", address: "Rue Ibn Khaldoun, El Manzah 6",
    lat: 36.852, lng: 10.150,
    photos: [APT_LIVING, APT_KITCHEN, BEDROOM],
    docs: ["Titre foncier", "Certificat de propriété", "Plan de situation"],
  },
  {
    owner: bank,
    title: "🏛️ STB · Local commercial 220m² · Lac 2",
    description: "Local commercial situé au rez-de-chaussée d'un immeuble standing. Idéal restaurant, bureau ou showroom. Mise à prix sous valeur de marché — bien adjugé suite procédure de saisie.",
    type: "commercial", area_sqm: 220, rooms: null, bathrooms: 2, floor: 0, year_built: 2010,
    governorate: "Tunis", delegation: "Les Berges du Lac", address: "Rue du Lac Lochness, Lac 2",
    lat: 36.842, lng: 10.265,
    photos: [COMMERCIAL, SHOP, OFFICE],
    docs: ["Titre foncier", "PV de saisie", "Rapport d'expertise judiciaire"],
  },
  {
    owner: bank,
    title: "🏛️ STB · Villa duplex 320m² · La Marsa Plage",
    description: "Villa duplex sur 2 niveaux, terrain 480m². Bien adjugé suite procédure de recouvrement. Vente à la barre — toutes garanties bancaires.",
    type: "villa", area_sqm: 320, rooms: 5, bathrooms: 4, floor: 0, year_built: 2008,
    governorate: "Tunis", delegation: "La Marsa", address: "Rue de la Plage, La Marsa Plage",
    lat: 36.886, lng: 10.323,
    photos: [VILLA, HOUSE, VILLA_POOL, BEACH_VIEW],
    docs: ["Titre foncier", "PV de saisie", "Acte de prêt original", "Rapport d'expertise"],
  },
  {
    owner: agency,
    title: "Appartement haut standing S+3 · Les Jardins de Carthage",
    description: "Vendu par Tecnocasa. Résidence sécurisée, ascenseur, parking sous-sol. Belle exposition Sud-Ouest, grand balcon. Dossier impeccable.",
    type: "apartment", area_sqm: 145, rooms: 4, bathrooms: 2, floor: 2, year_built: 2020,
    governorate: "Tunis", delegation: "Carthage", address: "Les Jardins de Carthage",
    lat: 36.857, lng: 10.323,
    photos: [APT_LIVING, APT_KITCHEN, BEDROOM, BATHROOM],
    docs: ["Titre foncier", "Règlement de copropriété", "Certificat de propriété"],
  },
  {
    owner: ahmed,
    title: "Studio S+0 meublé · La Goulette",
    description: "Studio entièrement meublé et équipé, à 100m de la plage. Idéal investissement Airbnb / location courte durée. Vendu meublé.",
    type: "apartment", area_sqm: 38, rooms: 1, bathrooms: 1, floor: 2, year_built: 2012,
    governorate: "Tunis", delegation: "La Goulette", address: "Rue de la Plage, La Goulette",
    lat: 36.819, lng: 10.305,
    photos: [APT_LIVING_2, APT_KITCHEN],
    docs: ["Titre foncier", "Inventaire mobilier"],
  },
  {
    owner: agency,
    title: "Penthouse S+4 vue mer · Les Berges du Lac 1",
    description: "Penthouse exceptionnel au dernier étage avec terrasse panoramique de 80m². Vue dégagée sur le lac et la baie de Tunis. Standing premium, prestations haut de gamme.",
    type: "apartment", area_sqm: 260, rooms: 5, bathrooms: 3, floor: 8, year_built: 2019,
    governorate: "Tunis", delegation: "Les Berges du Lac", address: "Avenue de la Bourse, Lac 1",
    lat: 36.840, lng: 10.247,
    photos: [APT_LIVING, TERRACE, BEDROOM, APT_KITCHEN],
    docs: ["Titre foncier", "Certificat de propriété", "Règlement de copropriété"],
  },
  {
    owner: leila,
    title: "Appartement S+2 · Mutuelleville",
    description: "Appartement traversant dans résidence calme du centre. 2 chambres, double living, cuisine équipée. Proche écoles françaises et ambassades.",
    type: "apartment", area_sqm: 120, rooms: 3, bathrooms: 2, floor: 3, year_built: 2005,
    governorate: "Tunis", delegation: "Mutuelleville", address: "Rue de Madrid, Mutuelleville",
    lat: 36.819, lng: 10.171,
    photos: [APT_LIVING, APT_KITCHEN, BEDROOM],
    docs: ["Titre foncier", "Quitus charges syndicat"],
  },
  {
    owner: sami,
    title: "Villa · El Aouina",
    description: "Villa familiale 4 chambres avec jardin 200m². Garage 2 voitures. Quartier résidentiel, proche aéroport. Travaux de rafraîchissement à prévoir.",
    type: "villa", area_sqm: 240, rooms: 4, bathrooms: 3, floor: 0, year_built: 1998,
    governorate: "Tunis", delegation: "El Aouina", address: "Rue Hassan Ibn Noaman, El Aouina",
    lat: 36.857, lng: 10.247,
    photos: [VILLA, HOUSE_2, COURTYARD],
    docs: ["Titre foncier", "Permis de bâtir"],
  },
  {
    owner: leila,
    title: "Maison traditionnelle · Sidi Bou Saïd",
    description: "Petite maison de charme dans le village bleu et blanc. Architecture typique, 2 chambres, patio, terrasse vue mer. Bien rare.",
    type: "house", area_sqm: 110, rooms: 2, bathrooms: 2, floor: 0, year_built: 1965,
    governorate: "Tunis", delegation: "Sidi Bou Saïd", address: "Rue Sidi El Houssine, Sidi Bou Saïd",
    lat: 36.870, lng: 10.347,
    photos: [HOUSE_3, COURTYARD, TERRACE],
    docs: ["Titre foncier", "Certificat de propriété", "Avis Patrimoine"],
  },
  {
    owner: sami,
    title: "Appartement S+1 · Bardo",
    description: "Bien d'investissement à fort potentiel locatif. Proche faculté du Bardo et tramway. Rénovation légère conseillée.",
    type: "apartment", area_sqm: 72, rooms: 2, bathrooms: 1, floor: 2, year_built: 1990,
    governorate: "Tunis", delegation: "Le Bardo", address: "Avenue 14 Janvier, Le Bardo",
    lat: 36.811, lng: 10.135,
    photos: [APT_LIVING_2, APT_KITCHEN],
    docs: ["Titre foncier"],
  },
  {
    owner: leila,
    title: "Terrain à bâtir 600m² · La Soukra",
    description: "Terrain plat, viabilisé, dans lotissement résidentiel. Proche autoroute et zone commerciale. Idéal villa familiale.",
    type: "land", area_sqm: 600, rooms: null, bathrooms: null, floor: null, year_built: null,
    governorate: "Tunis", delegation: "La Soukra", address: "Lotissement Riadh, La Soukra",
    lat: 36.881, lng: 10.235,
    photos: [LAND, LAND_AGRI],
    docs: ["Titre foncier", "Certificat de bornage", "Permis de lotir"],
  },
  {
    owner: agency,
    title: "Bureau plateau 180m² · Centre Urbain Nord",
    description: "Plateau de bureaux en open space, 4 salles fermées + accueil. Climatisation centralisée, fibre optique installée. Parking sous-sol 4 places.",
    type: "office", area_sqm: 180, rooms: 5, bathrooms: 2, floor: 5, year_built: 2016,
    governorate: "Tunis", delegation: "Centre Urbain Nord", address: "Rue Lac Toba, Centre Urbain Nord",
    lat: 36.842, lng: 10.193,
    photos: [OFFICE, OFFICE_2, COMMERCIAL],
    docs: ["Titre foncier", "Permis d'usage commercial", "Plan d'aménagement"],
  },

  // ─── SFAX — 5 listings ────────────────────────────────────────────────────
  {
    owner: leila,
    title: "أرض بناء 800m² · حي السلام · صفاقس",
    description: "أرض جاهزة للبناء، مقسمة، مع شهادة تخطيط. مستوية، تطل على شارعين. مناسبة لفيلا أو عمارة سكنية.",
    type: "land", area_sqm: 800, rooms: null, bathrooms: null, floor: null, year_built: null,
    governorate: "Sfax", delegation: "El Salam", address: "حي السلام, صفاقس",
    lat: 34.728, lng: 10.762,
    photos: [LAND, LAND_OLIVE],
    docs: ["Titre foncier", "Certificat de bornage", "Permis de lotir"],
  },
  {
    owner: agency,
    title: "Bureau professionnel 90m² · Sfax Centre",
    description: "Bureau au 1er étage, idéal cabinet médical, avocat, ou expert-comptable. Ascenseur, climatisation centrale, parking visiteurs.",
    type: "office", area_sqm: 90, rooms: 4, bathrooms: 1, floor: 1, year_built: 2017,
    governorate: "Sfax", delegation: "Sfax Médina", address: "Avenue Ali Belhouane, Sfax",
    lat: 34.7398, lng: 10.7600,
    photos: [OFFICE, OFFICE_2],
    docs: ["Titre foncier", "Permis d'usage commercial"],
  },
  {
    owner: ahmed,
    title: "Villa S+4 · Sakiet Eddaier",
    description: "Villa neuve livrée 2022, jardin paysager 250m², garage 2 voitures, salle de jeux au sous-sol. Quartier résidentiel calme, sécurisé.",
    type: "villa", area_sqm: 310, rooms: 5, bathrooms: 4, floor: 0, year_built: 2022,
    governorate: "Sfax", delegation: "Sakiet Eddaier", address: "Cité El Hadhik, Sakiet Eddaier",
    lat: 34.812, lng: 10.722,
    photos: [VILLA, HOUSE_3, COURTYARD, BEDROOM],
    docs: ["Titre foncier", "Permis de bâtir", "Procès-verbal de réception"],
  },
  {
    owner: sami,
    title: "Appartement S+2 · Route Soukra Sfax",
    description: "Appartement traversant dans immeuble récent. 2 chambres, salon double, cuisine américaine. Proche établissements scolaires.",
    type: "apartment", area_sqm: 115, rooms: 3, bathrooms: 2, floor: 3, year_built: 2016,
    governorate: "Sfax", delegation: "Route Soukra", address: "Route Soukra km 4, Sfax",
    lat: 34.768, lng: 10.738,
    photos: [APT_LIVING_2, APT_KITCHEN, BEDROOM],
    docs: ["Titre foncier", "Règlement de copropriété"],
  },
  {
    owner: leila,
    title: "Ferme avec oliviers 3 hectares · Sfax Sud",
    description: "Exploitation oléicole en production. 320 oliviers adultes, puits artésien, hangar agricole. Excellente rentabilité, comptabilité disponible.",
    type: "land", area_sqm: 30000, rooms: null, bathrooms: null, floor: null, year_built: null,
    governorate: "Sfax", delegation: "Mahres", address: "Route de Mahres km 18",
    lat: 34.531, lng: 10.501,
    photos: [LAND_OLIVE, LAND_AGRI, LAND],
    docs: ["Titre foncier", "Certificat d'exploitation agricole", "Étude pédologique"],
  },

  // ─── SOUSSE + MONASTIR + MAHDIA — 5 listings ──────────────────────────────
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
    owner: agency,
    title: "Villa moderne · Sousse Khézama Est",
    description: "Villa contemporaine livrée 2021, terrain 450m². Cuisine américaine, dressing, suite parentale. Domotique installée. Vue dégagée.",
    type: "villa", area_sqm: 290, rooms: 4, bathrooms: 3, floor: 0, year_built: 2021,
    governorate: "Sousse", delegation: "Khézama Est", address: "Rue Cheikh Mohamed El Fadhel, Khézama Est",
    lat: 35.852, lng: 10.620,
    photos: [VILLA_MED, VILLA_POOL, BEDROOM, APT_KITCHEN],
    docs: ["Titre foncier", "Permis de bâtir", "Certificat de conformité"],
  },
  {
    owner: ahmed,
    title: "Studio · Port El Kantaoui",
    description: "Studio vue port avec balcon. Résidence avec piscine et accès plage. Idéal pied-à-terre vacances ou location saisonnière.",
    type: "apartment", area_sqm: 42, rooms: 1, bathrooms: 1, floor: 2, year_built: 2008,
    governorate: "Sousse", delegation: "Port El Kantaoui", address: "Résidence Marina, Port El Kantaoui",
    lat: 35.892, lng: 10.591,
    photos: [APT_LIVING_2, BEACH_VIEW],
    docs: ["Titre foncier", "Règlement de copropriété"],
  },
  {
    owner: leila,
    title: "Appartement S+2 · Monastir Centre",
    description: "Bien rénové, à 200m de la plage et de la marina. Climatisation, ascenseur. Excellent rapport locatif saisonnier.",
    type: "apartment", area_sqm: 95, rooms: 3, bathrooms: 2, floor: 4, year_built: 2010,
    governorate: "Monastir", delegation: "Monastir Médina", address: "Avenue Habib Bourguiba, Monastir",
    lat: 35.762, lng: 10.831,
    photos: [APT_LIVING, APT_KITCHEN, BEDROOM],
    docs: ["Titre foncier", "Quittance copropriété"],
  },
  {
    owner: ahmed,
    title: "Villa pied dans l'eau · Mahdia",
    description: "Villa exceptionnelle accès direct plage. 4 chambres, terrasse vue mer 360°, jardin tropical. Bien rare sur ce segment.",
    type: "villa", area_sqm: 380, rooms: 5, bathrooms: 4, floor: 0, year_built: 2014,
    governorate: "Mahdia", delegation: "Mahdia Plage", address: "Route de la Corniche, Mahdia",
    lat: 35.503, lng: 11.061,
    photos: [VILLA_MED, BEACH_VIEW, TERRACE, VILLA_POOL],
    docs: ["Titre foncier", "Permis de bâtir", "Étude de sol"],
  },

  // ─── HAMMAMET + NABEUL — 4 listings ───────────────────────────────────────
  {
    owner: leila,
    title: "Villa avec piscine · Hammamet Sud",
    description: "Villa de standing 280 m² sur terrain de 600 m². 4 chambres, double salon, cuisine équipée, piscine 8x4, garage 2 voitures. Vue mer indirecte. Quartier résidentiel calme.",
    type: "villa", area_sqm: 280, rooms: 4, bathrooms: 3, floor: 0, year_built: 2015,
    governorate: "Nabeul", delegation: "Hammamet", address: "Route touristique, Hammamet Sud",
    lat: 36.378, lng: 10.563,
    photos: [VILLA, VILLA_POOL, HOUSE_3, BEDROOM],
    docs: ["Titre foncier", "Permis de bâtir", "Quitus fiscal"],
  },
  {
    owner: agency,
    title: "Appartement S+2 · Yasmine Hammamet",
    description: "Appartement dans résidence avec piscine, à 5 minutes de la marina. Climatisation centrale, parking. Belle vue sur les jardins.",
    type: "apartment", area_sqm: 88, rooms: 3, bathrooms: 2, floor: 2, year_built: 2009,
    governorate: "Nabeul", delegation: "Yasmine Hammamet", address: "Médina Méditerranéa, Yasmine Hammamet",
    lat: 36.367, lng: 10.554,
    photos: [APT_LIVING_2, APT_KITCHEN, BEACH_VIEW],
    docs: ["Titre foncier", "Règlement de copropriété"],
  },
  {
    owner: sami,
    title: "Maison · Nabeul Centre",
    description: "Maison de ville 3 chambres, patio andalou central, terrasse aménagée. Quartier authentique proche du souk de poteries.",
    type: "house", area_sqm: 160, rooms: 3, bathrooms: 2, floor: 0, year_built: 1985,
    governorate: "Nabeul", delegation: "Nabeul Médina", address: "Rue du Souk, Nabeul",
    lat: 36.451, lng: 10.735,
    photos: [HOUSE_2, COURTYARD, TERRACE],
    docs: ["Titre foncier"],
  },
  {
    owner: ahmed,
    title: "Terrain agricole 2 hectares · Korba",
    description: "Terrain agricole irrigué. Plantation d'agrumes en production (orangers, mandariniers). Forage individuel, bassin d'irrigation.",
    type: "land", area_sqm: 20000, rooms: null, bathrooms: null, floor: null, year_built: null,
    governorate: "Nabeul", delegation: "Korba", address: "Route de Korba km 8",
    lat: 36.575, lng: 10.860,
    photos: [LAND_AGRI, LAND_OLIVE],
    docs: ["Titre foncier", "Certificat d'exploitation agricole"],
  },

  // ─── OTHER GOVERNORATES — 4 listings ──────────────────────────────────────
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
    title: "Houch traditionnel · Djerba Houmt Souk",
    description: "Maison djerbienne traditionnelle (houch), 3 chambres autour du patio. Coupoles, voûtes, mosaïques d'origine. Travaux d'entretien à prévoir.",
    type: "house", area_sqm: 200, rooms: 3, bathrooms: 2, floor: 0, year_built: 1955,
    governorate: "Médenine", delegation: "Houmt Souk", address: "Rue Mohamed Ferjani, Houmt Souk",
    lat: 33.875, lng: 10.857,
    photos: [HOUSE_3, COURTYARD, TERRACE],
    docs: ["Titre foncier", "Certificat de propriété"],
  },
  {
    owner: sami,
    title: "Villa · Kelibia",
    description: "Villa familiale 4 chambres, vue Cap Bon. Jardin avec figuiers et oliviers. À 800m de la plage de Mansoura.",
    type: "villa", area_sqm: 220, rooms: 4, bathrooms: 3, floor: 0, year_built: 2011,
    governorate: "Nabeul", delegation: "Kelibia", address: "Route de Mansoura, Kelibia",
    lat: 36.851, lng: 11.094,
    photos: [VILLA_MED, HOUSE, TERRACE, BEACH_VIEW],
    docs: ["Titre foncier", "Permis de bâtir"],
  },
  {
    owner: ahmed,
    title: "Appartement S+1 · Gabès Centre",
    description: "Appartement lumineux, traversant. Cuisine équipée, salle d'eau rénovée. Proche corniche et avenue Habib Bourguiba.",
    type: "apartment", area_sqm: 78, rooms: 2, bathrooms: 1, floor: 2, year_built: 2002,
    governorate: "Gabès", delegation: "Gabès Médina", address: "Avenue Farhat Hached, Gabès",
    lat: 33.881, lng: 10.098,
    photos: [APT_LIVING_2, APT_KITCHEN],
    docs: ["Titre foncier"],
  },
];

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
  await sb.from("watchlist").delete().in("auction_id", ids);
  await sb.from("auctions").delete().in("id", ids);
}

// Each plan row references a propertyIdx into the `properties` array
// above. Mix of live english/sealed/dutch, scheduled, ended_sold,
// direct sales (listing_type='direct' with a fixed sale_price), and
// auctions with a buy_now_price escape hatch.
const auctionPlan = [
  // ─── 0 · Apt Le Manzah — English LIVE, ends in 6h, hot bidding
  { propertyIdx: 0, type: "english", listing_type: "auction",
    opening_price: 380_000, reserve_price: 410_000,
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
  // ─── 1 · STB Local Lac 2 — English LIVE, ends in 22h
  { propertyIdx: 1, type: "english", listing_type: "auction",
    opening_price: 1_200_000, reserve_price: 1_350_000,
    starts_at: hoursFromNow(-12), ends_at: hoursFromNow(22), status: "live",
    bids: [
      { user: leila,    amount: 1_200_000 },
      { user: diaspora, amount: 1_210_000, max: 1_280_000, isProxy: true },
    ],
  },
  // ─── 2 · STB Villa La Marsa — Sealed LIVE, ends in 3 days
  { propertyIdx: 2, type: "sealed", listing_type: "auction",
    opening_price: 1_500_000, reserve_price: 1_700_000,
    starts_at: hoursFromNow(-24), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: ahmed,    amount: 1_600_000 },
      { user: leila,    amount: 1_680_000 },
      { user: diaspora, amount: 1_720_000 },
    ],
  },
  // ─── 3 · Penthouse Carthage S+3 — English LIVE
  { propertyIdx: 3, type: "english", listing_type: "auction",
    opening_price: 720_000, reserve_price: 800_000,
    starts_at: hoursFromNow(-6), ends_at: hoursFromNow(36), status: "live",
    bids: [
      { user: ahmed,    amount: 720_000 },
      { user: sami,     amount: 740_000 },
      { user: diaspora, amount: 760_000, max: 820_000, isProxy: true },
    ],
  },
  // ─── 4 · Studio La Goulette — DIRECT SALE (négociable)
  { propertyIdx: 4, type: "english", listing_type: "direct",
    opening_price: 145_000, sale_price: 145_000, sale_negotiable: true,
    starts_at: hoursFromNow(-72), ends_at: daysFromNow(60), status: "live",
    current_price: 145_000,
    bids: [],
  },
  // ─── 5 · Penthouse Lac 1 — English SCHEDULED, opens in 2 days
  { propertyIdx: 5, type: "english", listing_type: "auction",
    opening_price: 1_800_000, reserve_price: 2_000_000,
    starts_at: daysFromNow(2), ends_at: daysFromNow(9), status: "scheduled",
    bids: [],
  },
  // ─── 6 · Mutuelleville S+2 — Sealed SCHEDULED
  { propertyIdx: 6, type: "sealed", listing_type: "auction",
    opening_price: 480_000, reserve_price: 540_000,
    starts_at: daysFromNow(1), ends_at: daysFromNow(8), status: "scheduled",
    bids: [],
  },
  // ─── 7 · Villa El Aouina — English LIVE
  { propertyIdx: 7, type: "english", listing_type: "auction",
    opening_price: 850_000, reserve_price: 920_000,
    starts_at: hoursFromNow(-30), ends_at: hoursFromNow(48), status: "live",
    bids: [
      { user: ahmed,    amount: 850_000 },
      { user: leila,    amount: 870_000 },
      { user: diaspora, amount: 900_000, max: 1_000_000, isProxy: true },
    ],
  },
  // ─── 8 · Maison Sidi Bou Saïd — DIRECT SALE (charm bien, ferme)
  { propertyIdx: 8, type: "english", listing_type: "direct",
    opening_price: 650_000, sale_price: 650_000, sale_negotiable: false,
    starts_at: hoursFromNow(-120), ends_at: daysFromNow(45), status: "live",
    current_price: 650_000,
    bids: [],
  },
  // ─── 9 · Apt Bardo — English ENDED & SOLD (last week)
  { propertyIdx: 9, type: "english", listing_type: "auction",
    opening_price: 95_000, reserve_price: 110_000,
    starts_at: daysFromNow(-14), ends_at: daysFromNow(-7), status: "ended_sold",
    winner_user_id: diaspora, winner_amount: 128_000, hammer_at: daysFromNow(-7),
    current_price: 128_000,
    bids: [
      { user: ahmed,    amount: 95_000 },
      { user: leila,    amount: 105_000 },
      { user: diaspora, amount: 128_000, max: 150_000 },
    ],
  },
  // ─── 10 · Terrain La Soukra 600m² — DIRECT SALE (négociable)
  { propertyIdx: 10, type: "english", listing_type: "direct",
    opening_price: 285_000, sale_price: 285_000, sale_negotiable: true,
    starts_at: hoursFromNow(-200), ends_at: daysFromNow(90), status: "live",
    current_price: 285_000,
    bids: [],
  },
  // ─── 11 · Bureau CUN — English SCHEDULED
  { propertyIdx: 11, type: "english", listing_type: "auction",
    opening_price: 620_000, reserve_price: 700_000,
    starts_at: daysFromNow(4), ends_at: daysFromNow(11), status: "scheduled",
    bids: [],
  },
  // ─── 12 · Terrain 800m² Sfax — English LIVE + BUY NOW
  { propertyIdx: 12, type: "english", listing_type: "auction",
    opening_price: 165_000, reserve_price: 185_000, buy_now_price: 220_000,
    starts_at: hoursFromNow(-8), ends_at: daysFromNow(5), status: "live",
    bids: [
      { user: ahmed, amount: 165_000 },
      { user: sami,  amount: 172_000 },
    ],
  },
  // ─── 13 · Bureau Sfax Centre — DIRECT SALE
  { propertyIdx: 13, type: "english", listing_type: "direct",
    opening_price: 195_000, sale_price: 195_000, sale_negotiable: true,
    starts_at: hoursFromNow(-60), ends_at: daysFromNow(50), status: "live",
    current_price: 195_000,
    bids: [],
  },
  // ─── 14 · Villa Sakiet Eddaier — English LIVE
  { propertyIdx: 14, type: "english", listing_type: "auction",
    opening_price: 580_000, reserve_price: 650_000,
    starts_at: hoursFromNow(-18), ends_at: daysFromNow(2), status: "live",
    bids: [
      { user: sami,  amount: 580_000 },
      { user: leila, amount: 600_000, max: 640_000, isProxy: true },
    ],
  },
  // ─── 15 · Apt Route Soukra Sfax — English SCHEDULED
  { propertyIdx: 15, type: "english", listing_type: "auction",
    opening_price: 235_000, reserve_price: 265_000,
    starts_at: daysFromNow(3), ends_at: daysFromNow(10), status: "scheduled",
    bids: [],
  },
  // ─── 16 · Ferme oliviers Sfax 3ha — Sealed LIVE
  { propertyIdx: 16, type: "sealed", listing_type: "auction",
    opening_price: 320_000, reserve_price: 380_000,
    starts_at: hoursFromNow(-36), ends_at: daysFromNow(4), status: "live",
    bids: [
      { user: leila, amount: 350_000 },
      { user: ahmed, amount: 380_000 },
    ],
  },
  // ─── 17 · Apt Sousse Centre — Dutch LIVE (ticks down 145k→95k)
  { propertyIdx: 17, type: "dutch", listing_type: "auction",
    opening_price: 95_000,
    dutch_start_price: 145_000, dutch_floor_price: 95_000,
    dutch_decrement: 2_500, dutch_tick_seconds: 1800, // -2.5k every 30 min
    starts_at: hoursFromNow(-3), ends_at: hoursFromNow(45), status: "live",
    bids: [],
  },
  // ─── 18 · Villa Khézama Sousse — English LIVE
  { propertyIdx: 18, type: "english", listing_type: "auction",
    opening_price: 920_000, reserve_price: 1_050_000,
    starts_at: hoursFromNow(-24), ends_at: daysFromNow(3), status: "live",
    bids: [
      { user: ahmed,    amount: 920_000 },
      { user: leila,    amount: 950_000 },
      { user: diaspora, amount: 980_000, max: 1_080_000, isProxy: true },
    ],
  },
  // ─── 19 · Studio Port El Kantaoui — English ENDED & SOLD
  { propertyIdx: 19, type: "english", listing_type: "auction",
    opening_price: 78_000, reserve_price: 92_000,
    starts_at: daysFromNow(-21), ends_at: daysFromNow(-14), status: "ended_sold",
    winner_user_id: ahmed, winner_amount: 105_000, hammer_at: daysFromNow(-14),
    current_price: 105_000,
    bids: [
      { user: leila,    amount: 78_000 },
      { user: diaspora, amount: 88_000 },
      { user: ahmed,    amount: 105_000, max: 115_000 },
    ],
  },
  // ─── 20 · Apt Monastir — English LIVE + BUY NOW
  { propertyIdx: 20, type: "english", listing_type: "auction",
    opening_price: 215_000, reserve_price: 240_000, buy_now_price: 280_000,
    starts_at: hoursFromNow(-10), ends_at: hoursFromNow(50), status: "live",
    bids: [
      { user: sami,  amount: 215_000 },
      { user: ahmed, amount: 225_000 },
    ],
  },
  // ─── 21 · Villa pied dans l'eau Mahdia — English LIVE, premium
  { propertyIdx: 21, type: "english", listing_type: "auction",
    opening_price: 1_400_000, reserve_price: 1_600_000,
    starts_at: hoursFromNow(-48), ends_at: daysFromNow(5), status: "live",
    bids: [
      { user: diaspora, amount: 1_400_000, max: 1_700_000, isProxy: true },
      { user: leila,    amount: 1_450_000 },
      { user: ahmed,    amount: 1_500_000 },
    ],
  },
  // ─── 22 · Villa Hammamet Sud — English LIVE
  { propertyIdx: 22, type: "english", listing_type: "auction",
    opening_price: 720_000, reserve_price: 800_000,
    starts_at: hoursFromNow(-6), ends_at: daysFromNow(2), status: "live",
    bids: [
      { user: ahmed,    amount: 720_000 },
      { user: sami,     amount: 740_000 },
      { user: diaspora, amount: 760_000, max: 820_000, isProxy: true },
    ],
  },
  // ─── 23 · Apt Yasmine Hammamet — English SCHEDULED
  { propertyIdx: 23, type: "english", listing_type: "auction",
    opening_price: 175_000, reserve_price: 200_000,
    starts_at: daysFromNow(5), ends_at: daysFromNow(12), status: "scheduled",
    bids: [],
  },
  // ─── 24 · Maison Nabeul Centre — DIRECT SALE (négociable)
  { propertyIdx: 24, type: "english", listing_type: "direct",
    opening_price: 245_000, sale_price: 245_000, sale_negotiable: true,
    starts_at: hoursFromNow(-100), ends_at: daysFromNow(60), status: "live",
    current_price: 245_000,
    bids: [],
  },
  // ─── 25 · Terrain agricole Korba 2ha — English LIVE + BUY NOW
  { propertyIdx: 25, type: "english", listing_type: "auction",
    opening_price: 320_000, reserve_price: 370_000, buy_now_price: 420_000,
    starts_at: hoursFromNow(-12), ends_at: daysFromNow(6), status: "live",
    bids: [
      { user: leila, amount: 320_000 },
    ],
  },
  // ─── 26 · Bailiff Maison Bizerte — English LIVE, judicial sale
  { propertyIdx: 26, type: "english", listing_type: "auction",
    opening_price: 285_000, reserve_price: null,
    starts_at: hoursFromNow(-72), ends_at: hoursFromNow(48), status: "live",
    bids: [
      { user: sami,  amount: 285_000 },
      { user: leila, amount: 295_000 },
      { user: ahmed, amount: 305_000 },
    ],
  },
  // ─── 27 · Houch traditionnel Djerba — DIRECT SALE (négociable)
  { propertyIdx: 27, type: "english", listing_type: "direct",
    opening_price: 180_000, sale_price: 180_000, sale_negotiable: true,
    starts_at: hoursFromNow(-150), ends_at: daysFromNow(75), status: "live",
    current_price: 180_000,
    bids: [],
  },
  // ─── 28 · Villa Kelibia — Sealed SCHEDULED
  { propertyIdx: 28, type: "sealed", listing_type: "auction",
    opening_price: 520_000, reserve_price: 600_000,
    starts_at: daysFromNow(2), ends_at: daysFromNow(9), status: "scheduled",
    bids: [],
  },
  // ─── 29 · Apt Gabès Centre — English ENDED & SOLD
  { propertyIdx: 29, type: "english", listing_type: "auction",
    opening_price: 78_000, reserve_price: 95_000,
    starts_at: daysFromNow(-30), ends_at: daysFromNow(-23), status: "ended_sold",
    winner_user_id: sami, winner_amount: 102_000, hammer_at: daysFromNow(-23),
    current_price: 102_000,
    bids: [
      { user: ahmed, amount: 78_000 },
      { user: leila, amount: 92_000 },
      { user: sami,  amount: 102_000, max: 110_000 },
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
  { property: propertyIds[0].id,  requestedBy: diaspora, inspector: inspectorIds[0], kind: "virtual_live", scheduled_at: daysFromNow(2),  status: "scheduled", fee: 350 },
  { property: propertyIds[2].id,  requestedBy: leila,    inspector: inspectorIds[3], kind: "full",         scheduled_at: daysFromNow(-3), status: "approved",  fee: 800, report: "mock/reports/marsa-villa.pdf" },
  { property: propertyIds[3].id,  requestedBy: ahmed,    inspector: inspectorIds[0], kind: "full",         scheduled_at: daysFromNow(1),  status: "scheduled", fee: 700 },
  { property: propertyIds[5].id,  requestedBy: diaspora, inspector: inspectorIds[0], kind: "virtual_live", scheduled_at: daysFromNow(4),  status: "requested", fee: 400 },
  { property: propertyIds[14].id, requestedBy: ahmed,    inspector: inspectorIds[2], kind: "standard",     scheduled_at: daysFromNow(-7), status: "approved",  fee: 350, report: "mock/reports/sfax-villa.pdf" },
  { property: propertyIds[18].id, requestedBy: leila,    inspector: inspectorIds[1], kind: "full",         scheduled_at: daysFromNow(3),  status: "scheduled", fee: 750 },
  { property: propertyIds[21].id, requestedBy: diaspora, inspector: inspectorIds[1], kind: "full",         scheduled_at: daysFromNow(-1), status: "approved",  fee: 900, report: "mock/reports/mahdia-villa.pdf" },
  { property: propertyIds[26].id, requestedBy: sami,     inspector: inspectorIds[3], kind: "standard",     scheduled_at: daysFromNow(-4), status: "approved",  fee: 300, report: "mock/reports/bizerte-house.pdf" },
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
