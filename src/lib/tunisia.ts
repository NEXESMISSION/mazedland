/**
 * Shared Tunisia-domain constants. Pulled out of SellForm so signup,
 * login, search filters, and explore all agree on the same canonical
 * list of 24 gouvernorats (and aren't fighting over typos like
 * "Médenine" vs "Medenine").
 */

export const TUNISIAN_GOVERNORATES = [
  "Tunis",
  "Ariana",
  "Ben Arous",
  "Manouba",
  "Sousse",
  "Monastir",
  "Mahdia",
  "Nabeul",
  "Sfax",
  "Bizerte",
  "Gabès",
  "Médenine",
  "Kairouan",
  "Béja",
  "Jendouba",
  "Kef",
  "Kasserine",
  "Sidi Bouzid",
  "Gafsa",
  "Tozeur",
  "Kebili",
  "Tataouine",
  "Siliana",
  "Zaghouan",
] as const;

export type TunisianGovernorate = (typeof TUNISIAN_GOVERNORATES)[number];

/**
 * Dial codes for the phone field. Tunisia leads (the platform's
 * primary market), then the diaspora destinations (France, Italy,
 * Germany, Belgium, Switzerland, UAE, Canada, USA, etc.) so an
 * expat investor can sign up with their actual phone number.
 *
 * The list is intentionally short — there's no point shipping a
 * 200-country dropdown for an audience that's overwhelmingly
 * Tunisia-resident or Tunisia-diaspora.
 */
export const DIAL_CODES: { code: string; label: string }[] = [
  { code: "+216", label: "+216 Tunisie" },
  { code: "+33",  label: "+33 France" },
  { code: "+39",  label: "+39 Italie" },
  { code: "+49",  label: "+49 Allemagne" },
  { code: "+32",  label: "+32 Belgique" },
  { code: "+41",  label: "+41 Suisse" },
  { code: "+34",  label: "+34 Espagne" },
  { code: "+31",  label: "+31 Pays-Bas" },
  { code: "+44",  label: "+44 Royaume-Uni" },
  { code: "+1",   label: "+1 USA / Canada" },
  { code: "+971", label: "+971 Émirats" },
  { code: "+966", label: "+966 Arabie saoudite" },
  { code: "+974", label: "+974 Qatar" },
  { code: "+965", label: "+965 Koweït" },
  { code: "+973", label: "+973 Bahreïn" },
  { code: "+968", label: "+968 Oman" },
  { code: "+961", label: "+961 Liban" },
  { code: "+962", label: "+962 Jordanie" },
  { code: "+20",  label: "+20 Égypte" },
  { code: "+212", label: "+212 Maroc" },
  { code: "+213", label: "+213 Algérie" },
  { code: "+90",  label: "+90 Turquie" },
];

/**
 * Normalize a (dialCode, raw number) pair to E.164.
 *   - Strips spaces, dashes, parens.
 *   - Trims one or more leading zeros that callers often type before
 *     the local number (e.g. "08 1234 567" instead of "8 1234 567").
 *   - Returns null when the result doesn't look like a plausible
 *     phone (under 6 digits after the dial code, or non-numeric).
 *
 * Tunisia (+216) gets an extra constraint: the local part must be
 * exactly 8 digits — that's the only valid mobile format and
 * accepting anything else just lets typos through to SMS providers
 * who will reject them on send.
 */
export function normalizeE164(
  dialCode: string,
  rawNumber: string,
): string | null {
  const digits = rawNumber.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;
  if (dialCode === "+216") {
    if (digits.length !== 8) return null;
  } else if (digits.length < 6 || digits.length > 15) {
    return null;
  }
  return `${dialCode}${digits}`;
}

/**
 * Phone validator that returns a specific French reason on failure,
 * for surfacing in the signup/login forms. Mirrors normalizeE164's
 * rules but says "what's wrong" instead of just null.
 *
 *   "+216" → exactly 8 digits required ("vous en avez N")
 *   other  → 6–15 digits required (E.164 spec)
 *
 * Used by the forms before normalizeE164. The forms still call
 * normalizeE164 after validatePhone succeeds, so a downstream change
 * to either function doesn't break the other.
 */
export function validatePhone(
  dialCode: string,
  rawNumber: string,
): { ok: true } | { ok: false; reason: string } {
  const digits = rawNumber.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) {
    return { ok: false, reason: "Tapez votre numéro de téléphone." };
  }
  if (dialCode === "+216") {
    if (digits.length !== 8) {
      return {
        ok: false,
        reason: `Un numéro tunisien doit faire 8 chiffres — vous en avez tapé ${digits.length}.`,
      };
    }
    return { ok: true };
  }
  if (digits.length < 6) {
    return {
      ok: false,
      reason: `Numéro trop court — il faut au moins 6 chiffres après l'indicatif ${dialCode}.`,
    };
  }
  if (digits.length > 15) {
    return {
      ok: false,
      reason: `Numéro trop long — maximum 15 chiffres après l'indicatif.`,
    };
  }
  return { ok: true };
}

/**
 * Split an E.164 number back into the (dialCode, local) pair our
 * UI expects. Used by the login form when prefilling from a saved
 * preference, and by the profile page when rendering the value the
 * user originally entered.
 *
 * Falls back to (default, original) when no known dial code matches,
 * so the function is safe on garbage / legacy values.
 */
export function splitE164(
  e164: string,
  defaultCode = "+216",
): { dialCode: string; number: string } {
  for (const c of DIAL_CODES) {
    if (e164.startsWith(c.code)) {
      return { dialCode: c.code, number: e164.slice(c.code.length) };
    }
  }
  return { dialCode: defaultCode, number: e164.replace(/^\+/, "") };
}
