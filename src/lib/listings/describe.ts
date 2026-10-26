/**
 * « Écrire la description pour moi »: the description, written from what the
 * seller already chose on the publish form.
 *
 * The description is the one long text box of the form, and on a phone it is
 * the step people skip — which costs them, since a reviewer and a buyer both
 * want a few lines. Everything those lines would say is already answered on
 * the way here: the deal, the type, the place, the surface, the rooms, what
 * is on site. This says it back as plain sentences, in the page's language,
 * from a template — no AI, nothing leaves the browser. The seller then edits
 * it like their own text.
 *
 * The highlight chips (« Vue mer », « Proche des écoles »…) each add one line,
 * written here too, and tapping one again takes its line back out.
 *
 * Pure, so the tests can pin every sentence.
 */
import type { DealType, Furnished } from "./deal";
import { listOfFields } from "./wizard";
import { delegationLabel } from "@/lib/delegations";
import { governorateLabel } from "@/lib/tunisia";
import { formatDate, formatNumber } from "@/lib/utils";

type Lang = "fr" | "ar";
const langOf = (locale: string): Lang => (locale === "ar" || locale.startsWith("ar-") ? "ar" : "fr");

type Gender = "m" | "f";
/** The singular noun for each category, and its gender — adjectives agree with it. */
const NOUNS: Record<string, Record<Lang, { word: string; g: Gender }>> = {
  appartements: { fr: { word: "Appartement", g: "m" }, ar: { word: "شقة", g: "f" } },
  villas: { fr: { word: "Villa", g: "f" }, ar: { word: "فيلا", g: "f" } },
  maisons: { fr: { word: "Maison", g: "f" }, ar: { word: "دار", g: "f" } },
  terrain: { fr: { word: "Terrain", g: "m" }, ar: { word: "أرض", g: "f" } },
  fermes: { fr: { word: "Ferme", g: "f" }, ar: { word: "ضيعة", g: "f" } },
  "locaux-commerciaux": { fr: { word: "Local commercial", g: "m" }, ar: { word: "محل تجاري", g: "m" } },
  bureaux: { fr: { word: "Bureau", g: "m" }, ar: { word: "مكتب", g: "m" } },
  depots: { fr: { word: "Dépôt", g: "m" }, ar: { word: "مستودع", g: "m" } },
};

/** What is on site, said the way a list of equipment says it. */
const EQUIPMENT: Record<string, Record<Lang, string>> = {
  air_conditioning: { fr: "climatisation", ar: "مكيّف" },
  heating: { fr: "chauffage central", ar: "تدفئة مركزية" },
  elevator: { fr: "ascenseur", ar: "مصعد" },
  parking: { fr: "parking", ar: "مأوى سيارة" },
  garden: { fr: "jardin", ar: "جنينة" },
  pool: { fr: "piscine", ar: "مسبح" },
};

/** The land questions: what a buyer of a plot asks first. Not equipment. */
const LAND_FACTS = ["buildable", "serviced", "titled"] as const;

const AR_ORDINAL = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];

export type DescribeInput = {
  locale: string;
  deal: DealType;
  categorySlug: string | null;
  /** The category as the form shows it, for one this file has no noun for. */
  categoryLabel: string | null;
  /** The numbers answered: area_sqm, rooms, bathrooms, floor, year_built. */
  numbers: Partial<Record<"area_sqm" | "rooms" | "bathrooms" | "floor" | "year_built", number | null>>;
  /** The yes/no questions answered yes, with the label the form shows for each. */
  yes: { key: string; label: string }[];
  governorate: string | null;
  delegation: string | null;
  quartier: string | null;
  /** Rentals only. */
  furnished: Furnished | null;
  availableFrom: string | null;
  /** YYYY-MM-DD where the seller is: a date already past is « libre tout de suite ». */
  today: string;
};

const num = (n: number, lang: Lang) => formatNumber(n, lang);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// A comma in both languages: in Tunisia a dot separates dinars from millimes.
const decimal = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** A count of rooms or bathrooms, with the Arabic dual and plural forms. */
function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}

function surface(area: number, slug: string | null, lang: Lang): string {
  // A farm, or a plot the size of one, is counted in hectares.
  const inHectares = (slug === "fermes" || slug === "terrain") && area >= 10_000;
  if (inHectares) return `${decimal(area / 10_000)} ${lang === "fr" ? "ha" : "هكتار"}`;
  return lang === "fr" ? `${num(area, lang)} m²` : `${num(area, lang)} م²`;
}

function floorText(floor: number, lang: Lang): string {
  if (lang === "fr") {
    if (floor === 0) return "au rez-de-chaussée";
    if (floor < 0) return "au sous-sol";
    return floor === 1 ? "au 1er étage" : `au ${floor}e étage`;
  }
  if (floor === 0) return "في الطابق الأرضي";
  if (floor < 0) return "في الطابق تحت الأرضي";
  return floor <= 10 ? `في الطابق ${AR_ORDINAL[floor]}` : `في الطابق ${floor}`;
}

/** The place, from the most precise to the governorate: « La Marsa (Tunis), quartier Gammarth ». */
function place(input: DescribeInput, lang: Lang): string {
  const gov = input.governorate ? governorateLabel(input.governorate, lang) : "";
  const del = input.delegation ? delegationLabel(input.delegation, lang) : "";
  const where = del && gov && del.toLowerCase() !== gov.toLowerCase() ? `${del} (${gov})` : del || gov;
  const quartier = input.quartier?.trim() ?? "";
  if (lang === "fr") return [where ? ` à ${where}` : "", quartier ? `, quartier ${quartier}` : ""].join("");
  return [where ? ` في ${where}` : "", quartier ? `، حومة ${quartier}` : ""].join("");
}

/**
 * The description, one short sentence per line: what and where, the sizes,
 * the year, what is on site, the land's papers, and for a rental how it is
 * let and from when. A line with nothing to say is left out.
 */
export function describeListing(input: DescribeInput): string {
  const lang = langOf(input.locale);
  const fr = lang === "fr";
  const noun = input.categorySlug ? NOUNS[input.categorySlug]?.[lang] : undefined;
  const word = noun?.word ?? input.categoryLabel?.trim() ?? (fr ? "Bien" : "عقار");
  const g: Gender = noun?.g ?? "m";
  const rent = input.deal === "rent";
  const n = input.numbers;
  const lines: string[] = [];

  // What, for which deal, and where.
  lines.push(`${word} ${fr ? (rent ? "à louer" : "à vendre") : rent ? "للكراء" : "للبيع"}${place(input, lang)}.`);

  // The sizes.
  const sizes: string[] = [];
  if (n.area_sqm != null && n.area_sqm > 0) {
    sizes.push(fr ? `surface de ${surface(n.area_sqm, input.categorySlug, lang)}` : `المساحة ${surface(n.area_sqm, input.categorySlug, lang)}`);
  }
  if (n.rooms != null && n.rooms > 0) {
    sizes.push(fr ? `${n.rooms} ${n.rooms > 1 ? "pièces" : "pièce"}` : arCount(n.rooms, "غرفة وحدة", "زوز غرف", "غرف", "غرفة"));
  }
  if (n.bathrooms != null && n.bathrooms > 0) {
    sizes.push(
      fr
        ? `${n.bathrooms} ${n.bathrooms > 1 ? "salles de bain" : "salle de bain"}`
        : arCount(n.bathrooms, "حمّام واحد", "زوز حمّامات", "حمّامات", "حمّام"),
    );
  }
  if (n.floor != null && Number.isInteger(n.floor)) sizes.push(floorText(n.floor, lang));
  if (sizes.length > 0) lines.push(`${capitalize(sizes.join(fr ? ", " : "، "))}.`);

  // The year: « neuf » when it is this one.
  if (n.year_built != null && n.year_built > 0) {
    const thisYear = Number(input.today.slice(0, 4));
    if (fr) {
      lines.push(n.year_built >= thisYear ? "Construction neuve." : `${g === "f" ? "Construite" : "Construit"} en ${n.year_built}.`);
    } else {
      lines.push(n.year_built >= thisYear ? "بناء جديد." : `${g === "f" ? "مبنية" : "مبني"} سنة ${n.year_built}.`);
    }
  }

  // What is on site. A question an admin added says its own label.
  const landKeys = new Set<string>(LAND_FACTS);
  const equipment = input.yes
    .filter((y) => !landKeys.has(y.key))
    .map((y) => EQUIPMENT[y.key]?.[lang] ?? (fr ? y.label.charAt(0).toLowerCase() + y.label.slice(1) : y.label));
  if (equipment.length > 0) {
    const list = listOfFields(equipment, lang);
    lines.push(fr ? `Équipements : ${list}.` : `${g === "f" ? "فيها" : "فيه"} ${list}.`);
  }

  // A plot's papers and whether it can be built on.
  const said = new Set(input.yes.map((y) => y.key));
  const land: string[] = [];
  if (said.has("buildable")) land.push(fr ? "constructible" : g === "f" ? "صالحة للبناء" : "صالح للبناء");
  if (said.has("serviced")) {
    land.push(fr ? (g === "f" ? "viabilisée" : "viabilisé") : g === "f" ? "مربوطة بالشبكات" : "مربوط بالشبكات");
  }
  if (land.length > 0 || said.has("titled")) {
    const titled = fr ? "avec titre foncier" : g === "f" ? "عندها رسم عقاري" : "عندو رسم عقاري";
    if (fr) {
      const adj = land.join(" et ");
      lines.push(`${capitalize(adj ? (said.has("titled") ? `${adj}, ${titled}` : adj) : titled)}.`);
    } else {
      const adj = land.join(" و");
      lines.push(`${adj ? (said.has("titled") ? `${adj}، و${titled}` : adj) : titled}.`);
    }
  }

  // A rental: how it is let, and from when.
  if (rent) {
    const parts: string[] = [];
    if (input.furnished) {
      parts.push(
        fr
          ? { furnished: "Location meublée", semi: "Location semi-meublée", unfurnished: "Location vide" }[input.furnished]
          : {
              furnished: g === "f" ? "تتكرى مفروشة" : "يتكرى مفروش",
              semi: g === "f" ? "تتكرى نص مفروشة" : "يتكرى نص مفروش",
              unfurnished: g === "f" ? "تتكرى بلا فرش" : "يتكرى بلا فرش",
            }[input.furnished],
      );
    }
    if (input.availableFrom) {
      const now = input.availableFrom <= input.today;
      const [y, m, d] = input.availableFrom.split("-").map(Number);
      // A local date, so the day printed is the day chosen in every time zone.
      const date = formatDate(new Date(y, m - 1, d), lang, "long");
      const free = fr ? (now ? "libre tout de suite" : `libre à partir du ${date}`) : now ? "تنجم تدخل من توّا" : `تنجم تدخل من ${date}`;
      parts.push(parts.length > 0 ? free : capitalize(free));
    }
    if (parts.length > 0) lines.push(`${parts.join(fr ? ", " : "، ")}.`);
  }

  return lines.join("\n");
}

/* ── Highlights ────────────────────────────────────────────────────────────── */

export const HIGHLIGHTS = [
  "seaView",
  "nearBeach",
  "nearSchools",
  "nearShops",
  "quietArea",
  "equippedKitchen",
  "terrace",
  "secureResidence",
  "renovated",
  "highStandard",
  "blueTitle",
  "easyAccess",
] as const;
export type Highlight = (typeof HIGHLIGHTS)[number];

/** Said of a building, not of a plot or a farm. */
const BUILDING_ONLY: readonly Highlight[] = ["equippedKitchen", "terrace", "secureResidence", "renovated", "highStandard"];
/** Said of a home, not of a shop, an office or a dépôt. */
const HOME_ONLY: readonly Highlight[] = ["nearBeach", "nearSchools", "quietArea", "equippedKitchen", "terrace"];

/**
 * The highlights that make sense for this annonce. A plot or a farm drops the
 * apartment ones (a kitchen, a terrace); a shop or an office the ones a family
 * looks for. « Titre bleu » is a buyer's question, so only for a sale.
 */
export function highlightsFor(
  slug: string | null | undefined,
  kind: string | null | undefined,
  deal: DealType,
): Highlight[] {
  const isLand = slug === "terrain" || slug === "fermes" || kind === "land";
  const isWork = ["locaux-commerciaux", "bureaux", "depots"].includes(slug ?? "") || kind === "commercial";
  return HIGHLIGHTS.filter((h) => {
    if (h === "blueTitle" && deal !== "sale") return false;
    if (isLand && BUILDING_ONLY.includes(h)) return false;
    if (isWork && HOME_ONLY.includes(h)) return false;
    return true;
  });
}

const HIGHLIGHT_LINES: Record<Highlight, Record<Lang, string>> = {
  seaView: { fr: "Vue sur la mer", ar: "إطلالة على البحر" },
  nearBeach: { fr: "Proche de la plage", ar: "قريب من البحر" },
  nearSchools: { fr: "Proche des écoles", ar: "قريب من المدارس" },
  nearShops: { fr: "Proche des commerces", ar: "قريب من المحلات" },
  quietArea: { fr: "Quartier calme", ar: "حومة هادية" },
  equippedKitchen: { fr: "Cuisine équipée", ar: "مطبخ مجهّز" },
  terrace: { fr: "Terrasse", ar: "تراس" },
  secureResidence: { fr: "Résidence sécurisée", ar: "إقامة محروسة" },
  renovated: { fr: "Rénové", ar: "مجدّد" },
  highStandard: { fr: "Haut standing", ar: "ستاندينغ عالي" },
  blueTitle: { fr: "Titre bleu", ar: "رسم عقاري أزرق" },
  easyAccess: { fr: "Accès facile", ar: "الوصول ساهل" },
};

/** The line a highlight adds to the description: « • Vue sur la mer ». */
export function highlightLine(h: Highlight, locale: string): string {
  return `• ${HIGHLIGHT_LINES[h][langOf(locale)]}`;
}

/* ── Editing the description without losing the seller's words ─────────────── */

const sameLine = (a: string, b: string) => a.trim() === b.trim();

/** Whether the description already holds this line, on a line of its own. */
export function hasLine(text: string, line: string): boolean {
  return text.split("\n").some((l) => sameLine(l, line));
}

/**
 * Add the line at the end, or take it out if it is there. Only that exact line
 * goes: what the seller wrote around it stays as they wrote it.
 */
export function toggleLine(text: string, line: string): string {
  if (hasLine(text, line)) {
    return text
      .split("\n")
      .filter((l) => !sameLine(l, line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }
  const kept = text.trimEnd();
  return kept ? `${kept}\n${line}` : line;
}

/** The lines of `text` that are highlight lines, in their order. */
function highlightLinesIn(text: string, highlightLines: readonly string[]): string[] {
  return text.split("\n").filter((l) => highlightLines.some((h) => sameLine(l, h))).map((l) => l.trim());
}

/**
 * Put the written description in the box — unless that would lose words the
 * seller typed. Nothing typed (empty, or only highlight lines): it goes in,
 * above the highlights. The box still starts with the text written last time
 * (they changed a room count and asked again): that part is rewritten, the
 * rest kept. Anything else is theirs, and the form asks.
 */
export function writeDescription(
  current: string,
  generated: string,
  { lastGenerated, highlightLines }: { lastGenerated: string | null; highlightLines: readonly string[] },
): { text: string } | { ask: true } {
  const typed = current.trim();
  if (typed === "") return { text: generated };
  if (lastGenerated && current.startsWith(lastGenerated)) {
    return { text: generated + current.slice(lastGenerated.length) };
  }
  const lines = typed.split("\n").filter((l) => l.trim() !== "");
  if (lines.every((l) => highlightLines.some((h) => sameLine(l, h)))) {
    return { text: `${generated}\n${lines.map((l) => l.trim()).join("\n")}` };
  }
  return { ask: true };
}

/** « Remplacer »: the written text, keeping the highlights already tapped. */
export function replaceDescription(current: string, generated: string, highlightLines: readonly string[]): string {
  const kept = highlightLinesIn(current, highlightLines);
  return kept.length > 0 ? `${generated}\n${kept.join("\n")}` : generated;
}

/** « Ajouter à la suite »: the seller's text, a blank line, then the written one. */
export function appendDescription(current: string, generated: string): string {
  const kept = current.trimEnd();
  return kept ? `${kept}\n\n${generated}` : generated;
}
