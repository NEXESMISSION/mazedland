/**
 * The rules an annonce must pass to be published without an admin reading it.
 *
 * Pure functions, no database: the server collects the facts (photo count,
 * category kind, the seller's other annonces) and this decides. A failed rule
 * never rejects anything — it sends the annonce to the manual queue with the
 * reason, so a rule that is too strict costs an admin a minute, not a seller
 * their annonce.
 */

import type { DealType } from "@/lib/listings/deal";

export const REVIEW_FLAGS = [
  "first_listing",
  "too_few_photos",
  "contact_in_text",
  "banned_words",
  "price_implausible",
  "duplicate",
  "reported",
  // A description that says nothing (« test test test », « ممتاز »), and a
  // surface no property of its kind has (a 33 m² farm) — the 2026-10-27 audit
  // found both online.
  "thin_text",
  "area_implausible",
] as const;

export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

/**
 * Fewer photos than this, and a human looks first. The default only: what
 * applies is `moderation_min_photos` (/admin/settings), which the server hands
 * to `checkListing`.
 */
export const MIN_PHOTOS = 3;

export type CategoryKind = "residential" | "land" | "commercial";

/** ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ → 0123456789, so a number typed on an Arabic
 *  keyboard is caught like any other. */
export function latinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Lower case, accents off, digits Latin, whitespace collapsed. */
export function normalizeText(s: string): string {
  return latinDigits(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A Tunisian number: eight digits, or the country code and then the eight
 * digits. The code is read only with its whole number after it — « 216 000
 * dinars », « 2160 m² » and « 1 216 000 TND » are a price and a surface — and
 * with the number, so that nothing of it stays once it is taken out.
 */
const PHONE = /(?:(?:\+|00)\s*|(?<!\d))216[\s.-]*(?:\d[\s.-]?){7}\d|(?<!\d)[2-9]\d(?:[\s.-]?\d){6}(?!\d)/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_LIKE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|tn|net|org|fr|io|me)\b/i;
const MESSENGERS = /whats\s?app|wa\.me|viber|telegram|messenger|واتس|واتساب|فايبر|تيليغرام/i;

/**
 * A way to reach the seller written into the text. The number is hidden behind
 * "Voir le numéro" on purpose — counted, rate-limited, never scraped — and a
 * number in the description walks straight around that.
 */
export function hasContactInText(text: string): boolean {
  const t = latinDigits(text);
  return PHONE.test(t) || EMAIL.test(t) || URL_LIKE.test(t) || MESSENGERS.test(t);
}

/**
 * The same patterns, taken out: for text that leaves the site (the AI
 * assistant, src/lib/ai) — a phone number or an e-mail has no business going
 * to a third party, and the model needs neither to read a property.
 */
export function redactContacts(text: string): string {
  return latinDigits(text)
    .replace(new RegExp(PHONE.source, "g"), "[…]")
    .replace(new RegExp(EMAIL.source, "gi"), "[…]")
    .replace(new RegExp(URL_LIKE.source, "gi"), "[…]");
}

/** Whole-word match for Latin words, substring for Arabic (which attaches
 *  articles and prepositions to the word). */
export function containsBannedWord(text: string, words: readonly string[]): boolean {
  const t = normalizeText(text);
  return words.some((w) => {
    const word = normalizeText(w);
    if (!word) return false;
    if (/[؀-ۿ]/.test(word)) return t.includes(word);
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(t);
  });
}

/**
 * Generous bounds: a price outside them is almost certainly a typo (15 TND, a
 * phone number in the price box) or bait, not a market price. Bounds per m²
 * catch "1 000 TND for a villa" without having to know the neighbourhood.
 * Farmland in the interior really does trade at a few dinars the m², hence the
 * low floor for land.
 *
 * A rent is a monthly figure, a few hundred to a few thousand dinars — the
 * sale bounds would send every rental to a human. Land rents by the
 * hectare-year, so its per-m² figure says nothing and is not checked.
 */
export function isPriceImplausible(input: {
  price: number | null;
  priceOnRequest: boolean;
  areaSqm: number | null;
  kind: CategoryKind | null;
  dealType?: DealType;
}): boolean {
  if (input.priceOnRequest || input.price == null) return false;
  const price = Number(input.price);
  if (!Number.isFinite(price)) return true;
  const area = Number(input.areaSqm);
  const hasArea = Number.isFinite(area) && area > 0;
  if (input.dealType === "rent") {
    if (price < 50 || price > 200_000) return true;
    if (!hasArea || input.kind === "land") return false;
    const perSqm = price / area;
    return perSqm < 0.5 || perSqm > 300;
  }
  if (price < 1_000 || price > 100_000_000) return true;
  if (!hasArea) return false;
  const perSqm = price / area;
  if (input.kind === "land") return perSqm < 0.5 || perSqm > 20_000;
  return perSqm < 100 || perSqm > 30_000;
}

/** Words that carry nothing on their own: a description made only of them is a placeholder. */
const PLACEHOLDER = /^(?:tests?|essai|lorem|ipsum|asdf|azerty|qwerty|x+|a+|abc|bla(?:bla)*|ok|na|tbd)$/;

/**
 * A description written but empty of content: fewer than three different
 * words once the placeholders are set aside. No description at all is not
 * this — it is optional, and the page says nothing rather than nonsense.
 */
export function isThinText(description: string | null): boolean {
  const words = normalizeText(description ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return false;
  return new Set(words.filter((w) => !PLACEHOLDER.test(w))).size < 3;
}

/**
 * A surface no property of the kind has: a plot or a farm under 50 m², a
 * home under 12 m² or over 20 000 m², premises under 5 m². Almost always a
 * unit typed wrong (hectares as m²) or a placeholder.
 */
export function isAreaImplausible(input: { areaSqm: number | null; kind: CategoryKind | null }): boolean {
  const a = Number(input.areaSqm);
  if (!Number.isFinite(a) || a <= 0) return false;
  if (input.kind === "land") return a < 50;
  if (input.kind === "residential") return a < 12 || a > 20_000;
  if (input.kind === "commercial") return a < 5;
  return false;
}

export type ListingFacts = {
  title: string;
  description: string | null;
  price: number | null;
  priceOnRequest: boolean;
  areaSqm: number | null;
  kind: CategoryKind | null;
  dealType: DealType;
  photoCount: number;
  /** Another live annonce of the same seller is the same property, on the
   *  same deal — a flat offered for sale and for rent at once is two offers. */
  duplicate: boolean;
};

/** The part of the rules an admin sets in /admin/settings → Modération. */
export type ListingRules = { minPhotos: number; bannedWords: readonly string[] };

/** Every rule the annonce fails, in a stable order. Empty means it passes. */
export function checkListing(facts: ListingFacts, rules: ListingRules): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const text = `${facts.title}\n${facts.description ?? ""}`;
  if (facts.photoCount < rules.minPhotos) flags.push("too_few_photos");
  if (hasContactInText(text)) flags.push("contact_in_text");
  if (containsBannedWord(text, rules.bannedWords)) flags.push("banned_words");
  if (isPriceImplausible(facts)) flags.push("price_implausible");
  if (facts.duplicate) flags.push("duplicate");
  if (isThinText(facts.description)) flags.push("thin_text");
  if (isAreaImplausible(facts)) flags.push("area_implausible");
  return flags;
}

/** Same property, as far as a title can tell: case, accents, spaces and
 *  punctuation do not make two annonces different. */
export function sameTitle(a: string, b: string): boolean {
  const key = (s: string) => normalizeText(s).replace(/[^\p{L}\p{N}]+/gu, "");
  return key(a) !== "" && key(a) === key(b);
}
