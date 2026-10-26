/**
 * How people reach Mazed Immo.
 *
 * WhatsApp is the channel, for messages only — nobody answers calls on it, so
 * the site never offers to dial it (no tel: link). The number is the
 * `contact_whatsapp` setting (/admin/settings → Contact; +216 58 415 510, given
 * by the owner on 2026-10-26, by default): `useSetting` in the browser,
 * `getSettings()` on the server.
 */

/** A wa.me link to a number, with an opening line already typed. */
export function whatsappHref(number: string, text?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
