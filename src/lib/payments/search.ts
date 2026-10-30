/**
 * What a finance admin types in the payments queue — pure.
 *
 * The reference printed on a transfer, « MAZED IMMO-C243037D », is the first
 * eight characters of the payment id (paymentReference in ./index.ts): nothing
 * is stored for it, so the search matched it on `provider_ref`, a column the
 * app never writes, and every reference a customer quoted came back empty.
 *
 * A uuid sorts as its hex digits, so a prefix becomes a range on `id`: every
 * id between `c243037d-0000-…` and `c243037d-ffff-…` starts with it. No column
 * to backfill, and a bare id prefix pasted from the console works too. The
 * words typed are kept for the payer's name and number and the motif.
 */

export type PaymentSearch = {
  /** `[low, high]` on `payments.id`, when the words can be a reference or an id prefix. */
  idRange: [string, string] | null;
  /** The words, for the name, the phone and the motif. */
  text: string;
};

/** « MAZED IMMO-C243037D », « mazed immo c243037d », « MAZEDIMMO_C24 » → « C243037D ». */
const REFERENCE_PREFIX = /^mazed\s*immo\s*[-–—_:]?\s*/i;

/** A uuid, or the start of one, as it is typed: hex digits with or without the dashes. */
const HEX_PREFIX = /^[0-9a-f-]+$/i;

const shape = (hex32: string) =>
  `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;

/** The ids that start with these hex digits, as the bounds of a range. */
export function uuidRangeForPrefix(prefix: string): [string, string] | null {
  const hex = prefix.replace(/-/g, "").toLowerCase();
  if (!hex || hex.length > 32 || !/^[0-9a-f]+$/.test(hex)) return null;
  return [shape(hex.padEnd(32, "0")), shape(hex.padEnd(32, "f"))];
}

export function parsePaymentSearch(raw: string): PaymentSearch {
  const text = raw.trim();
  const candidate = text.replace(REFERENCE_PREFIX, "").trim();
  // Two hex digits match too many ids to mean one; a name like « Dada » is
  // searched as a name as well, since both filters are or-ed.
  const idRange =
    candidate.length >= 3 && HEX_PREFIX.test(candidate) ? uuidRangeForPrefix(candidate) : null;
  return { idRange, text };
}
