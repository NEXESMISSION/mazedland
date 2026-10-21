/**
 * Sale or rent (0166).
 *
 * An annonce is one or the other, and `price` follows: the total for a sale,
 * the monthly rent for a rental. A rental also says what a sale never does —
 * deposit, charges, furnished, when it is free, the shortest lease — and each of
 * those is null until the owner says it: "no charges" is 0, not null, and a
 * page or a total must not present a silence as a zero.
 *
 * Pure: shared by the API, the wizard, the cards and the moderation rules.
 */

export const DEAL_TYPES = ["sale", "rent"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const FURNISHED = ["furnished", "semi", "unfurnished"] as const;
export type Furnished = (typeof FURNISHED)[number];

/** Anything that is not explicitly a rental is a sale — every annonce before
 *  0166 was one, and so is a row read without the column. */
export function asDealType(v: unknown): DealType {
  return v === "rent" ? "rent" : "sale";
}

export function isDealType(v: unknown): v is DealType {
  return v === "sale" || v === "rent";
}

/** The status an owner closes an annonce with: sold or let. */
export function closedStatus(deal: DealType): "sold" | "rented" {
  return deal === "rent" ? "rented" : "sold";
}

export type RentFacts = {
  deposit_amount: number | null;
  charges_amount: number | null;
  furnished: Furnished | null;
  available_from: string | null;
  min_lease_months: number | null;
};

/** What a sale stores in the rent columns: nothing (the 0166 check says so). */
export const NO_RENT_FACTS: RentFacts = {
  deposit_amount: null,
  charges_amount: null,
  furnished: null,
  available_from: null,
  min_lease_months: null,
};

function amount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null;
}

/** YYYY-MM-DD that is a real calendar day, or null. */
export function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const year = d.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? v : null;
}

/** The rent fields of a request body. Malformed means "not said", never an error:
 *  the wizard saves drafts as the seller types, half-typed values included. */
export function parseRentFacts(body: Record<string, unknown>): RentFacts {
  const lease = Number(body.min_lease_months);
  return {
    deposit_amount: amount(body.deposit_amount),
    charges_amount: amount(body.charges_amount),
    furnished: (FURNISHED as readonly unknown[]).includes(body.furnished)
      ? (body.furnished as Furnished)
      : null,
    available_from: isoDay(body.available_from),
    min_lease_months: Number.isInteger(lease) && lease >= 1 && lease <= 120 ? lease : null,
  };
}

/**
 * What it costs to move in: the first month's rent, the deposit and the
 * month's charges. Null unless all three are stated — a total that silently
 * leaves the deposit out would understate the one number a tenant budgets on.
 */
export function firstMonthCost(f: {
  price: number | null;
  priceOnRequest?: boolean;
  deposit: number | null;
  charges: number | null;
}): number | null {
  if (f.priceOnRequest || f.price == null || f.deposit == null || f.charges == null) return null;
  const parts = [Number(f.price), Number(f.deposit), Number(f.charges)];
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/** Whether a catalogue question is asked for this deal (null = both). */
export function appliesTo(dealTypes: readonly string[] | null | undefined, deal: DealType): boolean {
  return !dealTypes || dealTypes.length === 0 || dealTypes.includes(deal);
}
