/**
 * A search typed the way people talk (P3, without AI): « S+2 meublé à louer
 * Tunis 1200 dt », « أرض صفاقس 300 مليون », « villa nabeul moins de 800 mille ».
 * Read into the catalogue's own filters — offer, category, governorate,
 * délégation, rooms, surface, budget, furnished — and what is left stays a
 * keyword.
 *
 * Money the Tunisian way: « mille », « alf » and « ألف » are thousands of
 * dinars; « مليون » / « mlyoun » (and a Latin « million » that would be absurd
 * in dinars) is a thousand dinars — a million millimes; « مليار » is a million
 * dinars. Figures are written the French way too: « 300 000 », « 1 200 dt »,
 * « 350.000 », « 1,5 million ».
 *
 * Pure and deterministic: the same words always give the same filters.
 *
 * Word edges are spaces, not \b: JavaScript's \b only knows Latin letters,
 * so it never fires next to an Arabic word. The text is padded with spaces
 * and every pattern looks for them on both sides.
 */
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { DELEGATIONS } from "@/lib/delegations";

export type Understood = {
  deal?: "sale" | "rent";
  cat?: string;
  gov?: string;
  /** One of the governorate's délégations, in its stored spelling. */
  del?: string;
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
// A rent period (« 700 dt par mois », « في الشهر ») says « to rent » as well as the verb does.
const RENT_WORDS = [
  "louer", "location", "loue", "loyer", "rent", "mois", "mensuel", "mensuelle",
  "كراء", "للكراء", "نكري", "يتكرى", "كري", "إيجار", "للإيجار", "الإيجار", "الشهر", "شهريا", "شهري", "بالشهر",
];
const SALE_WORDS = ["vendre", "vente", "achat", "acheter", "achete", "بيع", "للبيع", "نشري", "شراء", "يتباع"];
const STOP_WORDS = [
  "a", "à", "au", "aux", "de", "des", "du", "d", "l", "la", "le", "les", "un", "une", "et", "ou", "en", "dans", "pour", "avec", "sur",
  "par", "je", "cherche", "recherche", "besoin", "veux", "voudrais", "prix", "budget", "dt", "tnd", "dinars", "dinar",
  // The words of a bound (« moins de », « au moins ») never make a keyword, even when the figure beside them was not one.
  "moins", "plus", "max", "maximum", "min", "minimum", "pas", "entre", "jusqu", "jusqua", "partir", "dessus", "dessous", "environ",
  "في", "على", "ب", "متاع", "و", "نحب", "نلوج", "عندي", "يلزمني", "بسوم", "سوم", "دينار", "د",
  "من", "حتى", "إلى", "ل", "أقل", "أكثر", "الأقل", "الأكثر", "موش", "مش", "تقريبا", "حوالي",
];

/** Lower case, no accents, Arabic hamza/ya folded, harakat dropped, digits Western, hyphens and apostrophes spaces. */
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
    .replace(/[’'-]/g, " ");
}

/**
 * A word as it is matched, and the same with a final ة typed as ه — « شقه »,
 * « اريانه », « جندوبه » are how many people write them. The words the person
 * typed keep their own spelling in what is left over.
 */
function spellings(w: string): string[] {
  const f = fold(w);
  return f.includes("ة") ? [f, f.replace(/ة/g, "ه")] : [f];
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The words of a list as one regex alternation, folded like the text. */
const alt = (words: string[]) => words.flatMap(spellings).map(esc).join("|");

const CATEGORIES: [string, Set<string>][] = CATEGORY_WORDS.map(([slug, list]) => [slug, new Set(list.flatMap(spellings))]);
const RENT = new Set(RENT_WORDS.flatMap(spellings));
const SALE = new Set(SALE_WORDS.flatMap(spellings));
const STOP = new Set(STOP_WORDS.flatMap(spellings));

const PLACES: { gov: string; forms: string[] }[] = TUNISIAN_GOVERNORATES.map((g) => ({
  gov: g,
  forms: [g, GOV_AR[g], ...(GOV_ALIASES[g] ?? [])].flatMap(spellings).sort((a, b) => b.length - a.length),
}));
const GOV_NAMES = new Set(TUNISIAN_GOVERNORATES.flatMap((g) => [...spellings(g), ...spellings(GOV_AR[g])]));

/**
 * Words too common to stand for a place on their own: « المدينة » is « the
 * town », « القصر » « the palace ». Their longer names still count.
 */
const TOO_COMMON = new Set(["المدينة", "القصر", "الزهور", "العيون", "التحرير", "السند"].flatMap(spellings));

/**
 * The 264 délégations, by the names people type: French with and without its
 * apostrophe (« m'saken », « msaken »), and Arabic. A délégation named like
 * its governorate (Nabeul, Monastir…) is read as the governorate.
 */
const DELEGATION_PLACES: { gov: string; del: string; forms: string[] }[] = TUNISIAN_GOVERNORATES.flatMap((g) =>
  DELEGATIONS[g].map(([fr, ar]) => ({
    gov: g,
    del: fr,
    forms: Array.from(new Set([fr, fr.replace(/['’]/g, ""), ar].flatMap(spellings)))
      .filter((f) => f && !GOV_NAMES.has(f) && !TOO_COMMON.has(f)),
  })),
);

// The units of a sum, in every spelling heard: Latin Derja (« alf »,
// « mlyoun ») as well as French and Arabic.
const THOUSAND = ["mille", "milles", "k", "alf", "alef", "elf", "ألف", "آلاف", "الاف"];
/** A Latin « million »: dinars, unless that would be absurd. */
const MILLION_FR = ["million", "millions"];
/** The Tunisian « million »: a thousand dinars. */
const MILLION_TN = ["مليون", "ملاين", "ملايين", "malyoun", "melyoun", "mlayen", "mlyoun", "mlioun", "milyoun", "melioun"];
const BILLION = ["مليار", "مليارات", "milliard", "milliards", "mlyar", "milyar"];
const DINAR = ["dt", "tnd", "dinar", "dinars", "د", "دينار", "دنانير", "د.ت"];
const UNITS = { THOUSAND, MILLION_FR, MILLION_TN, BILLION, DINAR } as const;
const UNIT_SETS = Object.fromEntries(Object.entries(UNITS).map(([k, l]) => [k, new Set(l.map(fold))])) as Record<keyof typeof UNITS, Set<string>>;

/** A sum the way it was said, in dinars. */
function money(n: number, unit: string | undefined): number | null {
  const u = fold(unit ?? "");
  if (UNIT_SETS.THOUSAND.has(u)) return n * 1000;
  if (UNIT_SETS.MILLION_FR.has(u)) return n * 1_000_000 > 20_000_000 ? n * 1000 : n * 1_000_000;
  if (UNIT_SETS.MILLION_TN.has(u)) return n * 1000;
  if (UNIT_SETS.BILLION.has(u)) return n * 1_000_000;
  if (UNIT_SETS.DINAR.has(u)) return n;
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

// The words that bound a sum. Said before the figure…
const CAP_BEFORE = [
  "moins de", "pas plus de", "au plus", "au maximum", "maximum", "max", "jusqu'à", "jusqua", "budget", "en dessous de", "sous", "sans dépasser",
  "أقل من", "موش أكثر من", "مش أكثر من", "ماكسيموم", "ماكس", "حتى", "أقصى", "أقصاه", "تحت", "ما يفوتش",
];
const FLOOR_BEFORE = [
  "plus de", "plus que", "pas moins de", "au moins", "au minimum", "minimum", "min", "à partir de", "au dessus de",
  "أكثر من", "موش أقل من", "مش أقل من", "على الأقل", "مينيموم", "فوق", "من", "ابتداء من", "بداية من",
];
// … or after it (« 300 mille minimum », « 300 ألف ماكسيموم »).
const CAP_AFTER_WORDS = ["maximum", "max", "au maximum", "au plus", "ماكسيموم", "ماكس", "أقصى", "كحد أقصى", "على الأكثر", "بالكثير"];
const FLOOR_AFTER_WORDS = ["minimum", "min", "au minimum", "au moins", "et plus", "مينيموم", "على الأقل", "وأكثر", "و أكثر", "وفوق"];

// Edges: a space before (the text is padded) and a space after.
const B = "(?<=\\s)";
const E = "(?=\\s)";
// A bound turned around by the word before it: « pas plus de » is a ceiling,
// « موش أقل من » a floor. Each list carries its own negated phrases; the bare
// phrase must not fire inside them.
const NOT_NEGATED = "(?<!pas\\s)(?<!موش\\s)(?<!مش\\s)";
const NUM = "(\\d+(?:[.,]\\d+)?)";
const UNIT = `(${alt(Object.values(UNITS).flat())})?`;
// Rooms: « s+2 », « s 2 » (a + lost in a URL), « s2 », « s plus 2 » (dictated).
const S_PLUS = /(?<=\s)[sس]\s*(?:\+|plus)?\s*(\d{1,2})(?=\s)/;
const ROOMS = new RegExp(`${B}(\\d{1,2})\\s*(pieces?|chambres?|بيوت|بيت|غرف)${E}`);
const AREA = new RegExp(`${B}(\\d{2,6})\\s*(m2|m²|metres?\\s*carres?|metres?|mc|متر\\s*مربع|متر|م2|م²)${E}`);
const UNFURNISHED = new RegExp(`${B}(non\\s*meublee?s?|vide|غير\\s*مفروش[ةه]?|فارغ[ةه]?)${E}`);
const FURNISHED = new RegExp(`${B}(meublee?s?|مفروش[ةه]?)${E}`);
// « entre 100 et 200 mille », « de 100 à 200 mille », « 100-200 mille ».
const RANGE = new RegExp(`${B}(?:(?:entre|de|بين|من)\\s+)?${NUM}\\s*${UNIT}\\s+(?:et|a|و|ل|حتى)\\s+${NUM}\\s*${UNIT}${E}`);
const CAPPED = new RegExp(`${B}${NOT_NEGATED}(?:${alt(CAP_BEFORE)})\\s*${NUM}\\s*${UNIT}${E}`);
const FLOOR = new RegExp(`${B}${NOT_NEGATED}(?:${alt(FLOOR_BEFORE)})\\s*${NUM}\\s*${UNIT}${E}`);
const CAPPED_AFTER = new RegExp(`${B}${NUM}\\s*${UNIT}\\s+(?:${alt(CAP_AFTER_WORDS)})${E}`);
const FLOOR_AFTER = new RegExp(`${B}${NUM}\\s*${UNIT}\\s+(?:${alt(FLOOR_AFTER_WORDS)})${E}`);
const PLAIN = new RegExp(`${B}${NUM}\\s*${UNIT}${E}`);

export function understand(input: string): Understood {
  // « 300-400 mille » is a range; fold() would make the dash a space.
  let s = ` ${fold(input.replace(/(?<=\d)\s*-\s*(?=\d)/g, " a "))
    // Punctuation is a space — except a comma between digits, the French
    // decimal (« 1,5 million »), and a period inside a word or a figure (« د.ت », « 1.2 »).
    .replace(/[،;!?()/:«»"]/g, " ")
    .replace(/(?<!\d),|,(?!\d)/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    // « بـ800 ألف »: the preposition is attached to the figure.
    .replace(/(?<=\s)ب(?=\d)/g, "ب ")
    .replace(/\s+/g, " ")} `;
  const out: Understood = { rest: "" };
  const take = (re: RegExp) => {
    s = s.replace(re, " ");
  };

  // Rooms first, while a small figure still stands alone: « S 2 300 000 ».
  const sPlus = s.match(S_PLUS);
  const rooms = s.match(ROOMS);
  if (sPlus) out.rooms = Number(sPlus[1]);
  // « 3 pièces » counts the salon — an S+2. « 3 chambres », « 3 بيوت » are the bedrooms.
  else if (rooms) out.rooms = Math.max(1, rooms[2].startsWith("piece") ? Number(rooms[1]) - 1 : Number(rooms[1]));
  if (sPlus) take(S_PLUS);
  if (rooms) take(ROOMS);

  // Digits grouped by three are one figure: « 300 000 », « 1 200 dt »,
  // « 350.000 » — the site prints its prices that way and so does dictation.
  // « 1,5 » and « 1.2 » keep their decimal.
  s = s.replace(/(?<=\d)[ .,](?=\d{3}(?!\d))/g, "");

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
  /** The sum a pattern names, taken out of the text when it reads as one. */
  const grab = (re: RegExp): number | null => {
    const m = s.match(re);
    const v = m ? amount(m[1], m[2]) : null;
    if (v != null) take(re);
    return v;
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
    const cap = grab(CAPPED) ?? grab(CAPPED_AFTER);
    if (cap != null) out.max = cap;
    const floor = grab(FLOOR) ?? grab(FLOOR_AFTER);
    if (floor != null) out.min = floor;
    // A lone figure is a ceiling: what the person can pay.
    if (out.max == null && out.min == null) {
      const plain = grab(PLAIN);
      if (plain != null) out.max = plain;
    }
  }

  // Words.
  const words = s.trim().split(/\s+/).filter(Boolean);
  const has = (set: Set<string>) => words.some((w) => set.has(w));
  if (has(RENT)) out.deal = "rent";
  else if (has(SALE)) out.deal = "sale";
  // A furnished place is a rental unless the words said otherwise.
  if (!out.deal && out.furnished === "furnished") out.deal = "rent";

  for (const [slug, set] of CATEGORIES) {
    if (has(set)) {
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
  // A délégation is more precise than its governorate: « la marsa » is La
  // Marsa, in Tunis. At equal length it wins over an alias (« la marsa » is
  // both); a délégation of the governorate named beside it wins over a
  // namesake elsewhere (Ezzouhour is in Tunis and in Kasserine).
  let del: { gov: string; del: string; form: string } | null = null;
  for (const d of DELEGATION_PLACES) {
    const hit = d.forms.find((f) => s.includes(` ${f} `));
    if (!hit) continue;
    const better =
      !del ||
      hit.length > del.form.length ||
      (hit.length === del.form.length && out.gov === d.gov && del.gov !== out.gov);
    if (better) del = { gov: d.gov, del: d.del, form: hit };
  }
  if (del && (!place || del.form.length >= place.length || GOV_NAMES.has(place))) {
    // Named with its governorate (« hammamet nabeul »), or alone.
    if (place && GOV_NAMES.has(place) && out.gov !== del.gov) {
      // « sfax ... la marsa »: two places, the governorate said outright wins.
      del = null;
    } else {
      out.gov = del.gov;
      out.del = del.del;
      s = s.replace(` ${del.form} `, " ");
      if (place && place !== del.form && GOV_NAMES.has(place)) s = s.replace(` ${place} `, " ");
      place = null;
    }
  }
  // A district that is not a délégation stays a keyword too: « ennasr »
  // narrows inside Ariana.
  const district = place && !GOV_NAMES.has(place) ? place : null;
  if (place) s = s.replace(` ${place} `, " ");

  const used = new Set<string>([...RENT, ...SALE, ...CATEGORIES.flatMap(([, set]) => [...set])]);
  const rest = s
    .trim()
    .split(/\s+/)
    .filter((w) => w && !used.has(w) && !STOP.has(w) && !/^[\d.,]+$/.test(w));
  out.rest = [district, ...rest].filter(Boolean).join(" ").trim();
  return out;
}

/** Whether the words said anything the filters can use. */
export function understoodSomething(u: Understood): boolean {
  return !!(u.deal || u.cat || u.gov || u.del || u.rooms || u.surface || u.min || u.max || u.furnished);
}
