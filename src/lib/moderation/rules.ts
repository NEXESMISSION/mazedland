/**
 * The rules an annonce must pass to be published without an admin reading it.
 *
 * Pure functions, no database: the server collects the facts (photo count,
 * category kind, the seller's other annonces) and this decides. A failed rule
 * never rejects anything — it sends the annonce to the manual queue with the
 * reason, so a rule that is too strict costs an admin a minute, not a seller
 * their annonce.
 */

export const REVIEW_FLAGS = [
  "first_listing",
  "too_few_photos",
  "contact_in_text",
  "banned_words",
  "price_implausible",
  "duplicate",
  "reported",
] as const;

export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

/** Fewer photos than this, and a human looks first. */
export const MIN_PHOTOS = 3;

/** Distinct reporters that take a published annonce off the catalogue. */
export const REPORT_THRESHOLD = 3;

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

const PHONE = /(?:\+|00)?\s*216[\s.-]*\d|(?<!\d)[2-9]\d(?:[\s.-]?\d){6}(?!\d)/;
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
 */
export function isPriceImplausible(input: {
  price: number | null;
  priceOnRequest: boolean;
  areaSqm: number | null;
  kind: CategoryKind | null;
}): boolean {
  if (input.priceOnRequest || input.price == null) return false;
  const price = Number(input.price);
  if (!Number.isFinite(price)) return true;
  if (price < 1_000 || price > 100_000_000) return true;
  const area = Number(input.areaSqm);
  if (!Number.isFinite(area) || area <= 0) return false;
  const perSqm = price / area;
  if (input.kind === "land") return perSqm < 0.5 || perSqm > 20_000;
  return perSqm < 100 || perSqm > 30_000;
}

export type ListingFacts = {
  title: string;
  description: string | null;
  price: number | null;
  priceOnRequest: boolean;
  areaSqm: number | null;
  kind: CategoryKind | null;
  photoCount: number;
  /** Another live annonce of the same seller is the same property. */
  duplicate: boolean;
};

/** Every rule the annonce fails, in a stable order. Empty means it passes. */
export function checkListing(facts: ListingFacts, bannedWords: readonly string[]): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const text = `${facts.title}\n${facts.description ?? ""}`;
  if (facts.photoCount < MIN_PHOTOS) flags.push("too_few_photos");
  if (hasContactInText(text)) flags.push("contact_in_text");
  if (containsBannedWord(text, bannedWords)) flags.push("banned_words");
  if (isPriceImplausible(facts)) flags.push("price_implausible");
  if (facts.duplicate) flags.push("duplicate");
  return flags;
}

/** Same property, as far as a title can tell: case, accents, spaces and
 *  punctuation do not make two annonces different. */
export function sameTitle(a: string, b: string): boolean {
  const key = (s: string) => normalizeText(s).replace(/[^\p{L}\p{N}]+/gu, "");
  return key(a) !== "" && key(a) === key(b);
}
