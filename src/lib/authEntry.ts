/**
 * What lands in the sign-in fields when nobody types it: a number the
 * browser autofills or the person pastes whole, an SMS code pasted with the
 * words around it. Each comes back as what the field holds. Pure, tested on
 * its own; src/components/auth/* use it.
 */
import { DIAL_CODES } from "@/lib/tunisia";

/** The dial codes, longest first, so « +971 » is not read as a shorter one. */
const CODES = DIAL_CODES.map((c) => c.code).sort((a, b) => b.length - a.length);

/**
 * A phone field's new text, split between the dial-code chip and the digits.
 *
 * `whole` is true when it arrived at once — autofill, a paste — rather than
 * one key at a time: then « +216 22 123 456 » or « 0021622123456 » moves its
 * code to the chip, provided a number's worth of digits follows it. Typed
 * key by key it is never re-read that way, or « 0020 » on its way to
 * « 00216 » would turn the chip Egyptian. Eleven digits starting with 216
 * under +216 are a Tunisian number with its code typed twice, whichever way
 * they came.
 */
export function phoneEntry(raw: string, dialCode: string, whole: boolean): { dialCode: string; number: string } {
  const s = raw.trim();
  if (whole && /^(\+|00)/.test(s)) {
    const intl = `+${s.replace(/^00/, "").replace(/\D/g, "")}`;
    const code = CODES.find((c) => intl.startsWith(c));
    if (code && intl.length - code.length >= 6) return { dialCode: code, number: intl.slice(code.length) };
  }
  const digits = s.replace(/\D/g, "");
  if (dialCode === "+216" && digits.length === 11 && digits.startsWith("216")) {
    return { dialCode, number: digits.slice(3) };
  }
  return { dialCode, number: digits };
}

/** The SMS codes are six digits (/api/auth/phone/send). */
export const OTP_LENGTH = 6;

/**
 * The code in what was typed or pasted. A whole SMS — « Votre code Mazed
 * Immo : 482 913 » — gives its six digits; a field limited to six characters
 * would have kept « Votre ». Typed digits are kept, up to six.
 */
export function otpEntry(raw: string, length: number = OTP_LENGTH): string {
  const run = raw.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`));
  if (run) return run[0];
  return raw.replace(/\D/g, "").slice(0, length);
}
