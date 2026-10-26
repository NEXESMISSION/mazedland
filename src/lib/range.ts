/**
 * Two bounds a person types: a budget's minimum and maximum.
 *
 * A minimum above the maximum matches nothing. The catalogue took « 500 000 –
 * 100 000 TND » as a filter and answered with an empty page and no reason, and
 * a demande holding it would never send an alert. The forms refuse it with a
 * message next to the field; what reaches the catalogue anyway (a typed or an
 * old link) is not applied, and the page says why.
 *
 * Pure: shared by the catalogue page, its budget fields, the demande form and
 * the demande API.
 */

/** Both bounds set, and the floor above the ceiling. Equal is a fair range. */
export function rangeInverted(min: number | null | undefined, max: number | null | undefined): boolean {
  return min != null && max != null && min > max;
}

/**
 * The bounds a search applies. An inverted pair is dropped whole rather than
 * half: which of the two was the slip cannot be told, and either guess would
 * filter on a number the person did not mean.
 */
export function usableRange(
  min: number | null | undefined,
  max: number | null | undefined,
): { min: number | null; max: number | null; inverted: boolean } {
  if (rangeInverted(min, max)) return { min: null, max: null, inverted: true };
  return { min: min ?? null, max: max ?? null, inverted: false };
}

/** A form field's text as a bound: empty, zero or not a number is "no bound". */
function bound(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The same check on what two inputs hold, before anything is sent. */
export function inputsInverted(min: string, max: string): boolean {
  return rangeInverted(bound(min), bound(max));
}
