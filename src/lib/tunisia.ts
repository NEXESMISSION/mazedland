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
 * Arabic names of the 24 governorates. The French name stays the stored value
 * (listings.governorate, profiles.governorate, URL filters); this is display
 * only.
 */
const GOVERNORATE_AR: Record<TunisianGovernorate, string> = {
  Tunis: "تونس",
  Ariana: "أريانة",
  "Ben Arous": "بن عروس",
  Manouba: "منوبة",
  Sousse: "سوسة",
  Monastir: "المنستير",
  Mahdia: "المهدية",
  Nabeul: "نابل",
  Sfax: "صفاقس",
  Bizerte: "بنزرت",
  Gabès: "قابس",
  Médenine: "مدنين",
  Kairouan: "القيروان",
  Béja: "باجة",
  Jendouba: "جندوبة",
  Kef: "الكاف",
  Kasserine: "القصرين",
  "Sidi Bouzid": "سيدي بوزيد",
  Gafsa: "قفصة",
  Tozeur: "توزر",
  Kebili: "قبلي",
  Tataouine: "تطاوين",
  Siliana: "سليانة",
  Zaghouan: "زغوان",
};

/**
 * A governorate's name in the reader's language. Unknown values (legacy rows,
 * free text) come back unchanged rather than blank.
 */
export function governorateLabel(name: string | null | undefined, locale: string): string {
  if (!name) return "";
  if (locale !== "ar") return name;
  return GOVERNORATE_AR[name as TunisianGovernorate] ?? name;
}

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
export const DIAL_CODES: { code: string; label: string; labelAr: string }[] = [
  { code: "+216", label: "+216 Tunisie",         labelAr: "+216 تونس" },
  { code: "+33",  label: "+33 France",           labelAr: "+33 فرنسا" },
  { code: "+39",  label: "+39 Italie",           labelAr: "+39 إيطاليا" },
  { code: "+49",  label: "+49 Allemagne",        labelAr: "+49 ألمانيا" },
  { code: "+32",  label: "+32 Belgique",         labelAr: "+32 بلجيكا" },
  { code: "+41",  label: "+41 Suisse",           labelAr: "+41 سويسرا" },
  { code: "+34",  label: "+34 Espagne",          labelAr: "+34 إسبانيا" },
  { code: "+31",  label: "+31 Pays-Bas",         labelAr: "+31 هولندا" },
  { code: "+44",  label: "+44 Royaume-Uni",      labelAr: "+44 بريطانيا" },
  { code: "+1",   label: "+1 USA / Canada",      labelAr: "+1 أمريكا / كندا" },
  { code: "+971", label: "+971 Émirats",         labelAr: "+971 الإمارات" },
  { code: "+966", label: "+966 Arabie saoudite", labelAr: "+966 السعودية" },
  { code: "+974", label: "+974 Qatar",           labelAr: "+974 قطر" },
  { code: "+965", label: "+965 Koweït",          labelAr: "+965 الكويت" },
  { code: "+973", label: "+973 Bahreïn",         labelAr: "+973 البحرين" },
  { code: "+968", label: "+968 Oman",            labelAr: "+968 عُمان" },
  { code: "+961", label: "+961 Liban",           labelAr: "+961 لبنان" },
  { code: "+962", label: "+962 Jordanie",        labelAr: "+962 الأردن" },
  { code: "+20",  label: "+20 Égypte",           labelAr: "+20 مصر" },
  { code: "+212", label: "+212 Maroc",           labelAr: "+212 المغرب" },
  { code: "+213", label: "+213 Algérie",         labelAr: "+213 الجزائر" },
  { code: "+90",  label: "+90 Turquie",          labelAr: "+90 تركيا" },
];

/** A dial-code option's label in the reader's language. */
export function dialCodeLabel(c: { label: string; labelAr: string }, locale: string): string {
  return locale === "ar" ? c.labelAr : c.label;
}

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
 * Phone validator for the signup/login forms. Mirrors normalizeE164's rules
 * but says "what's wrong" instead of just null — as a key under the shared
 * `phone.errors` namespace plus its values, which the form renders with
 * `t(`phone.errors.${check.code}`, check.values)`.
 *
 *   "+216" → exactly 8 digits required ("you typed N")
 *   other  → 6–15 digits required (E.164 spec)
 *
 * Used by the forms before normalizeE164. The forms still call
 * normalizeE164 after validatePhone succeeds, so a downstream change
 * to either function doesn't break the other.
 */
export type PhoneError =
  | { code: "empty"; values: Record<string, never> }
  | { code: "tunisianLength"; values: { count: number } }
  | { code: "tooShort"; values: { dialCode: string } }
  | { code: "tooLong"; values: Record<string, never> };

export function validatePhone(
  dialCode: string,
  rawNumber: string,
): { ok: true } | ({ ok: false } & PhoneError) {
  const digits = rawNumber.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return { ok: false, code: "empty", values: {} };
  if (dialCode === "+216") {
    if (digits.length !== 8) return { ok: false, code: "tunisianLength", values: { count: digits.length } };
    return { ok: true };
  }
  if (digits.length < 6) return { ok: false, code: "tooShort", values: { dialCode } };
  if (digits.length > 15) return { ok: false, code: "tooLong", values: {} };
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
