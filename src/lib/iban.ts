/**
 * IBAN validation — mod-97 checksum per ISO 13616.
 *
 * Used by:
 *   - PayoutRequestModal (client-side immediate feedback)
 *   - /api/seller/payouts (server-side authoritative check)
 *
 * Why mod-97 and not just length? A typo'd IBAN (transposed digits,
 * dropped one) almost always fails mod-97 but passes a length check.
 * That typo costs the operator a manual bank-call to fix, vs the
 * 5 lines of code below.
 */

/**
 * Strip spaces, uppercase. Returns "" for null/undefined/non-string input
 * so callers can chain into other checks without an extra guard.
 */
export function normalizeIban(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, "").toUpperCase();
}

/**
 * Lightweight length-and-format check. ISO 13616 caps IBANs at 34 chars
 * and requires the first two to be a country code.
 *
 * Note: the country-specific length isn't enforced here on purpose —
 * we accept Tunisia (24), France (27), Germany (22), Saudi (24), etc.
 * Cross-border listings are explicitly supported.
 */
export function looksLikeIban(iban: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban);
}

/**
 * Full mod-97 validation. Returns true only when:
 *   - the string looks like an IBAN (looksLikeIban above), and
 *   - the mod-97 checksum equals 1.
 *
 * Algorithm: move the leading 4 chars (country + check digits) to the
 * end, expand letters A=10..Z=35, parse as a big integer modulo 97.
 * Because the integer can exceed 2^53 we do the mod incrementally
 * digit-by-digit.
 */
export function isValidIban(rawIban: string): boolean {
  const iban = normalizeIban(rawIban);
  if (!looksLikeIban(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  // Expand letters into two-digit numbers (A=10, B=11, ...).
  let expanded = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") {
      expanded += ch;
    } else if (ch >= "A" && ch <= "Z") {
      expanded += String(ch.charCodeAt(0) - 55);
    } else {
      return false;
    }
  }

  // Incremental mod-97. Chunking 7 digits at a time keeps every
  // intermediate value safely under Number.MAX_SAFE_INTEGER (97 * 10^7 < 2^53).
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    const block = String(remainder) + expanded.slice(i, i + 7);
    remainder = Number(block) % 97;
  }
  return remainder === 1;
}

/**
 * For display: insert spaces every 4 chars ("TN59 1000 6035 ...").
 * Doesn't validate — caller decides whether to format only valid ones.
 */
export function formatIbanForDisplay(rawIban: string): string {
  const iban = normalizeIban(rawIban);
  return iban.replace(/(.{4})/g, "$1 ").trim();
}
