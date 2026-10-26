/**
 * A search typed the way people talk (P3, without AI): « S+2 meublé à louer
 * Tunis 1200 dt », « أرض صفاقس 300 مليون », « villa nabeul moins de 800 mille ».
 * Read into the catalogue's own filters — offer, category, governorate,
 * rooms, surface, budget, furnished — and what is left stays a keyword.
 *
 * Money the Tunisian way: « mille » and « ألف » are thousands of dinars;
 * « مليون » (and a Latin « million » that would be absurd in dinars) is a
 * thousand dinars — a million millimes; « مليار » is a million dinars.
 *
 * Pure and deterministic: the same words always give the same filters.
 *
 * Word edges are spaces, not \b: JavaScript's \b only knows Latin letters,
 * so it never fires next to an Arabic word. The text is padded with spaces
 * and every pattern looks for them on both sides.
 */
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

export type Understood = {
  deal?: "sale" | "rent";
  cat?: string;
  gov?: string;
  rooms?: number;
  surface?: number;
  min?: number;
  max?: number;
  furnished?: "furnished" | "unfurnished";
  /** The words nothing above took. */
  rest: string;
};

const GOV_AR: Record<string, string> = {
  Tunis: "تونس", Ariana: "اريانة", "Ben Arous": "بن عروس", Manouba: "منوبة", Sousse: "سوسة", Monastir: "المنستير",
  Mahdia: "المهدية", Nabeul: "نابل", Sfax: "صفاقس", Bizerte: "بنزرت", Gabès: "قابس", Médenine: "مدنين",
  Kairouan: "القيروان", Béja: "باجة", Jendouba: "جندوبة", Kef: "الكاف", Kasserine: "القصرين", "Sidi Bouzid": "سيدي بوزيد",
  Gafsa: "قفصة", Tozeur: "توزر", Kebili: "قبلي", Tataouine: "تطاوين", Siliana: "سليانة", Zaghouan: "زغوان",
};
/** Other ways the same places are written — and districts people search by. */
const GOV_ALIASES: Record<string, string[]> = {
  Bizerte: ["benzart", "bnzart"],
  "Ben Arous": ["benarous"],
  Médenine: ["medenine", "mednine", "djerba", "جربة", "zarzis", "جرجيس"],
  Nabeul: ["hammamet", "الحمامات", "kelibia", "قليبية"],
  Tunis: ["la marsa", "marsa", "المرسى", "carthage", "قرطاج", "la goulette", "حلق الوادي", "lac", "البحيرة"],
  Ariana: ["ennasr", "النصر", "la soukra", "soukra", "السكرة", "raoued", "رواد"],
  Kef: ["le kef", "el kef"],
  Monastir: ["skanes", "سقانص"],
  Sousse: ["kantaoui", "القنطاوي", "msaken", "مساكن"],
  Gabès: ["gabes"],
  Béja: ["beja"],
  Kebili: ["kébili"],
};

const CATEGORY_WORDS: [string, string[]][] = [
  ["appartements", ["appartement", "appartements", "appart", "apart", "studio", "duplex", "شقة", "شقق", "ستوديو", "دوبلكس"]],
  ["villas", ["villa", "villas", "فيلا", "فيلات", "فيلة"]],
  ["maisons", ["maison", "maisons", "houch", "hawch", "dar", "حوش", "دار", "منزل", "منازل"]],
  ["terrain", ["terrain", "terrains", "lot", "lotissement", "أرض", "أراضي", "مقسم", "قطعة"]],
  ["fermes", ["ferme", "fermes", "hanchir", "هنشير", "مزرعة", "ضيعة", "سانية"]],
  ["locaux-commerciaux", ["local", "locaux", "commerce", "commercial", "magasin", "محل", "محلات", "حانوت"]],
  ["bureaux", ["bureau", "bureaux", "مكتب", "مكاتب"]],
  ["depots", ["depot", "depots", "entrepot", "hangar", "مستودع", "مخزن", "هنقار"]],
];
const RENT_WORDS = ["louer", "location", "loue", "loyer", "rent", "كراء", "للكراء", "نكري", "يتكرى", "كري", "mensuel"];
const SALE_WORDS = ["vendre", "vente", "achat", "acheter", "achete", "بيع", "للبيع", "نشري", "شراء", "يتباع"];
const STOP = new Set([
  "a", "à", "au", "aux", "de", "des", "du", "d", "l", "la", "le", "les", "un", "une", "et", "ou", "en", "dans", "pour", "avec", "sur",
  "je", "cherche", "recherche", "besoin", "veux", "voudrais", "prix", "budget", "dt", "tnd", "dinars", "dinar",
  "في", "على", "ب", "متاع", "و", "نحب", "نلوج", "عندي", "يلزمني", "بسوم", "سوم", "دينار", "د",
]);

/** Lower case, no accents, Arabic hamza/ya folded, harakat dropped, digits Western. */
export function fold(s: string): string {
  // Hamza forms first: NFD would split « أ » into alif + a combining hamza.
  return s
    .replace(/[أإآ]/g, "ا")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ـً-ٕ]/g, "") // tatweel, harakat, combining hamza
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[’']/g, " ");
}

const PLACES: { gov: string; forms: string[] }[] = TUNISIAN_GOVERNORATES.map((g) => ({
  gov: g,
  forms: [g, GOV_AR[g], ...(GOV_ALIASES[g] ?? [])].map(fold).sort((a, b) => b.length - a.length),
}));
const GOV_NAMES = new Set(TUNISIAN_GOVERNORATES.flatMap((g) => [fold(g), fold(GOV_AR[g])]));

/** A sum the way it was said, in dinars. */
function money(n: number, unit: string | undefined): number | null {
  const u = fold(unit ?? "");
  if (/^(mille|milles|k|الف|الاف)$/.test(u)) return n * 1000;
  if (/^(million|millions)$/.test(u)) return n * 1_000_000 > 20_000_000 ? n * 1000 : n * 1_000_000;
  if (/^(مليون|ملاين|ملايين|malyoun|melyoun|mlayen)$/.test(u)) return n * 1000;
  if (/^(مليار|مليارات|milliard|milliards)$/.test(u)) return n * 1_000_000;
  if (/^(dt|tnd|dinars?|د|دينار|دنانير|د\.ت)$/.test(u)) return n;
  return null;
}

/**
 * A figure with no unit is a budget only when it looks like one: 300 dinars
 * and up, but not a year (« construite en 2020 ») — a rent of 1 950 dinars
 * is written « 1950 dt ».
 */
function bareBudget(v: number): boolean {
  return Number.isInteger(v) && v >= 300 && !(v >= 1900 && v <= 2099);
}

// Edges: a space before (the text is padded) and a space after.
const B = "(?<=\\s)";
const E = "(?=\\s)";
const NUM = "(\\d+(?:[.,]\\d+)?)";
const UNIT =
  "(mille|milles|k|الف|الاف|million|millions|مليون|ملاين|ملايين|malyoun|melyoun|mlayen|مليار|مليارات|milliards?|dt|tnd|dinars?|دينار|دنانير|د\\.ت|د)?";
const ROOMS = new RegExp(`${B}(\\d{1,2})\\s*(pieces?|chambres?|بيوت|بيت|غرف)${E}`);
const AREA = new RegExp(`${B}(\\d{2,6})\\s*(m2|m²|metres?\\s*carres?|metres?|mc|متر\\s*مربع|متر|م2|م²)${E}`);
const UNFURNISHED = new RegExp(`${B}(non\\s*meublee?s?|vide|غير\\s*مفروش[ةه]?|فارغ[ةه]?)${E}`);
const FURNISHED = new RegExp(`${B}(meublee?s?|مفروش[ةه]?)${E}`);
const RANGE = new RegExp(`${B}(?:entre|de|بين|من)\\s+${NUM}\\s*${UNIT}\\s+(?:et|a|و|ل|حتى)\\s+${NUM}\\s*${UNIT}${E}`);
const CAPPED = new RegExp(`${B}(?:moins de|max(?:imum)?|jusqu a|jusqua|budget|اقل من|ماكسيموم|حتى|اقصى)\\s*${NUM}\\s*${UNIT}${E}`);
const FLOOR = new RegExp(`${B}(?:plus de|min(?:imum)?|a partir de|اكثر من)\\s*${NUM}\\s*${UNIT}${E}`);
const PLAIN = new RegExp(`${B}${NUM}\\s*${UNIT}${E}`);

export function understand(input: string): Understood {
  let s = ` ${fold(input).replace(/[،,;!?()]/g, " ").replace(/\s+/g, " ")} `;
  const out: Understood = { rest: "" };
  const take = (re: RegExp) => {
    s = s.replace(re, " ");
  };

  // Rooms: « s+2 », « s 2 », « 3 pieces / chambres », « 3 بيوت ».
  const sPlus = s.match(/(?<=\s)s\s*\+\s*(\d{1,2})(?=\s)/);
  if (sPlus) {
    out.rooms = Number(sPlus[1]);
    take(/(?<=\s)s\s*\+\s*\d{1,2}(?=\s)/);
  } else {
    const rooms = s.match(ROOMS);
    if (rooms) {
      out.rooms = Number(rooms[1]);
      take(ROOMS);
    }
  }

  const area = s.match(AREA);
  if (area) {
    out.surface = Number(area[1]);
    take(AREA);
  }

  // « non meublé » first, or it would read as « meublé ».
  if (UNFURNISHED.test(s)) {
    out.furnished = "unfurnished";
    take(UNFURNISHED);
  } else if (FURNISHED.test(s)) {
    out.furnished = "furnished";
    take(FURNISHED);
  }

  // Money, with the words that bound it.
  const amount = (n: string, u?: string) => {
    const v = Number(n.replace(",", "."));
    const m = money(v, u) ?? (bareBudget(v) ? v : null);
    // Above 50 million dinars it is a phone number or a typo, not a budget.
    return m != null && m <= 50_000_000 ? m : null;
  };
  const r = s.match(RANGE);
  if (r) {
    const lo = amount(r[1], r[2] || r[4]);
    const hi = amount(r[3], r[4] || r[2]);
    if (lo != null && hi != null) {
      out.min = Math.min(lo, hi);
      out.max = Math.max(lo, hi);
      take(RANGE);
    }
  }
  if (out.max == null) {
    const c = s.match(CAPPED);
    if (c && amount(c[1], c[2]) != null) {
      out.max = amount(c[1], c[2])!;
      take(CAPPED);
    }
    const f = s.match(FLOOR);
    if (f && amount(f[1], f[2]) != null) {
      out.min = amount(f[1], f[2])!;
      take(FLOOR);
    }
    if (out.max == null && out.min == null) {
      const p = s.match(PLAIN);
      if (p && amount(p[1], p[2]) != null) {
        out.max = amount(p[1], p[2])!;
        take(PLAIN);
      }
    }
  }

  // Words.
  const words = s.trim().split(/\s+/).filter(Boolean);
  const has = (list: string[]) => words.some((w) => list.map(fold).includes(w));
  if (has(RENT_WORDS)) out.deal = "rent";
  else if (has(SALE_WORDS)) out.deal = "sale";
  // A furnished place is a rental unless the words said otherwise.
  if (!out.deal && out.furnished === "furnished") out.deal = "rent";

  for (const [slug, list] of CATEGORY_WORDS) {
    if (has(list)) {
      out.cat = slug;
      break;
    }
  }

  // The longest place name wins, so « sidi bouzid » is not read as something shorter.
  let place: string | null = null;
  for (const { gov, forms } of PLACES) {
    const hit = forms.find((f) => s.includes(` ${f} `));
    if (hit && (!place || hit.length > place.length)) {
      place = hit;
      out.gov = gov;
    }
  }
  // A district stays a keyword too: « la marsa » narrows inside Tunis.
  const district = place && !GOV_NAMES.has(place) ? place : null;
  if (place) s = s.replace(` ${place} `, " ");

  const used = new Set<string>([...RENT_WORDS, ...SALE_WORDS, ...CATEGORY_WORDS.flatMap(([, l]) => l)].map(fold));
  const rest = s
    .trim()
    .split(/\s+/)
    .filter((w) => w && !used.has(w) && !STOP.has(w) && !/^\d+$/.test(w));
  out.rest = [district, ...rest].filter(Boolean).join(" ").trim();
  return out;
}

/** Whether the words said anything the filters can use. */
export function understoodSomething(u: Understood): boolean {
  return !!(u.deal || u.cat || u.gov || u.rooms || u.surface || u.min || u.max || u.furnished);
}
