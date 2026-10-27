/**
 * What « Copier » puts on the clipboard at checkout: what the field of a bank
 * or D17 app accepts, which is not always what the page shows.
 *
 *   « 15.00 TND », « 15.00 د.ت »     → 15.00      an amount field takes a number
 *   « 07 003 0001234567890 78 »      → 07003…78   a RIB or D17 field often stops at 20 or 8 characters
 *   « TN59 0700 3000 … »             → TN590700…  an IBAN, the same
 *   « MAZED IMMO-1A2B3C4D »          → as shown   the reference is matched as it is written
 *
 * Pure, tested on its own; the fields come from paymentInstructions().
 */
export function clipboardText(value: string): string {
  const v = value.trim();
  // An amount and its currency, either way round.
  const amount = /^(\d+(?:[.,]\d+)?)\s*(?:TND|DT|د\.ت)$/i.exec(v);
  if (amount) return amount[1];
  // Digits in groups (RIB, D17 number) or an IBAN: the spaces are for reading.
  if (/^\d[\d\s]*\d$/.test(v) || /^[A-Z]{2}\d{2}[\d\s]+$/.test(v)) return v.replace(/\s+/g, "");
  return v;
}
