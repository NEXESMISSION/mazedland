/**
 * Ready answers for the publish form (src/app/[locale]/annonces/nouvelle/
 * PublishWizard.tsx): the chips a seller taps instead of typing a number.
 *
 * Most sellers do this on a phone, and a number keyboard for « 3 pièces » is
 * three taps and a chance to type 33. A chip is one tap. The answer stored is
 * still the plain number the filters read — these only decide which chip a
 * stored answer lights, and what a chip writes.
 *
 * Pure, so the tests can pin them without a browser.
 */

/* ── Counts: pièces, salles de bain, étage ─────────────────────────────────── */

/** A count asked with chips: the usual answers, then « N et + » for the rest. */
export type CountChips = {
  values: readonly number[];
  /** The last chip, « 6 et + »: it writes this and opens the box for more. */
  orMore: number;
};

const COUNT_CHIPS: Record<string, CountChips> = {
  rooms: { values: [1, 2, 3, 4, 5], orMore: 6 },
  bathrooms: { values: [1, 2, 3], orMore: 4 },
  // 0 is the ground floor: « RDC ».
  floor: { values: [0, 1, 2, 3, 4], orMore: 5 },
};

/** The chips for a catalogue question, or null for one asked as a typed number. */
export function countChipsFor(fieldKey: string): CountChips | null {
  return COUNT_CHIPS[fieldKey] ?? null;
}

/**
 * Which chip a stored answer lights: one of the values, "more" at or past the
 * last one, null when there is no answer or none fits (a basement typed as
 * -1, a half) — that one stays in the box, as typed.
 */
export function countChipOf(chips: CountChips, value: string): number | "more" | null {
  const s = value.trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isInteger(n)) return null;
  if (chips.values.includes(n)) return n;
  return n >= chips.orMore ? "more" : null;
}

/* ── Surface ───────────────────────────────────────────────────────────────── */

/** A quick surface under the box. A farm is counted in hectares. */
export type AreaChip = { value: number; hectares?: number };

const HECTARE = 10_000;

// What sellers of each kind most often write, by category slug.
const AREA_CHIPS: Record<string, readonly number[]> = {
  appartements: [60, 80, 100, 120, 150],
  villas: [150, 200, 300, 400],
  maisons: [150, 200, 300, 400],
  terrain: [200, 300, 500, 1000, 5000],
  fermes: [HECTARE, 2 * HECTARE, 5 * HECTARE, 10 * HECTARE],
  bureaux: [30, 50, 100, 200],
  "locaux-commerciaux": [30, 50, 100, 200],
  depots: [100, 300, 500, 1000],
};

/** The quick surfaces for a category; none for one this file does not know. */
export function areaChipsFor(slug: string | null | undefined): AreaChip[] {
  const values = slug ? AREA_CHIPS[slug] : undefined;
  if (!values) return [];
  return values.map((value) => (slug === "fermes" ? { value, hectares: value / HECTARE } : { value }));
}

/* ── Year built ────────────────────────────────────────────────────────────── */

export const OLDEST_YEAR = 1950;

/**
 * The years the picker offers, newest first: this year (« Neuf ») down to
 * 1950. A stored year outside that — a 1930 house, one still being built —
 * is kept in the list, or the picker would show it as unanswered.
 */
export function yearOptions(currentYear: number, stored = ""): number[] {
  const years: number[] = [];
  for (let y = currentYear; y >= OLDEST_YEAR; y--) years.push(y);
  const kept = Number(stored.trim());
  if (stored.trim() !== "" && Number.isInteger(kept) && !years.includes(kept)) {
    years.push(kept);
    years.sort((a, b) => b - a);
  }
  return years;
}

/* ── Rent terms ────────────────────────────────────────────────────────────── */

/** The deposit, counted in months of rent. */
export const DEPOSIT_MONTHS = [1, 2, 3] as const;

/** The deposit for `months` of this rent, as the form holds it; null without a rent. */
export function depositFor(monthly: string, months: number): string | null {
  const rent = Number(monthly);
  if (!(rent > 0) || !Number.isFinite(rent)) return null;
  return String(Math.round(rent * months * 100) / 100);
}

/** How many months of rent a deposit is, when it is exactly one of the chips. */
export function depositMonthsOf(deposit: string, monthly: string): number | null {
  if (deposit.trim() === "") return null;
  return DEPOSIT_MONTHS.find((m) => depositFor(monthly, m) === String(Number(deposit))) ?? null;
}

/** The shortest lease, in months. */
export const LEASE_MONTHS = [1, 6, 12, 24] as const;

/** The preset a stored number is, or null when it is empty or none of them. */
export function presetOf<T extends number>(value: string, presets: readonly T[]): T | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return presets.find((p) => p === n) ?? null;
}

/**
 * Today as YYYY-MM-DD where the seller is. Read on the server and handed to
 * the form, so « Tout de suite » means the same day on both sides of the
 * render — a server in UTC is still on yesterday until 1 a.m. in Tunis.
 */
export function isoDayIn(date: Date, timeZone: string): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The same day `months` later; the 31st of a shorter month lands on its last day. */
export function addMonths(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** « Tout de suite », « Dans 1 mois », or a date picked by hand. */
export type AvailableChoice = "now" | "inMonth" | "date";

/**
 * Which chip a stored date lights. A day already past reads as « Tout de
 * suite »: a draft saved last week with today's date is free now, not « le 19 ».
 */
export function availableChoiceOf(value: string, today: string): AvailableChoice | null {
  if (!value) return null;
  if (value <= today) return "now";
  return value === addMonths(today, 1) ? "inMonth" : "date";
}

/* ── Price ─────────────────────────────────────────────────────────────────── */

/**
 * The prices offered from the estimate (src/lib/listings/priceCheck.ts):
 * its low end, its middle and its high end, rounded as the estimate is.
 * Two when the middle rounds onto an end, one when the range is a point.
 */
export function estimateChips(estimate: { low: number; high: number } | null, rent: boolean): number[] {
  if (!estimate || !(estimate.low > 0) || !(estimate.high > 0)) return [];
  const step = rent ? 10 : 1000;
  const middle = Math.round((estimate.low + estimate.high) / 2 / step) * step;
  return Array.from(new Set([estimate.low, middle, estimate.high])).sort((a, b) => a - b);
}

/* ── Contact ───────────────────────────────────────────────────────────────── */

/**
 * The names a seller may show, from the one on their profile: the whole
 * name, and the first name with an initial — « Karim B. », the way most
 * annonces sign. One word is offered as it is.
 */
export function nameChoices(fullName: string): string[] {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length === 1) return [words[0]];
  return [words.join(" "), `${words[0]} ${Array.from(words[1])[0]}.`];
}
