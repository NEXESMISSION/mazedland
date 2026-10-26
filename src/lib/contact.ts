/**
 * How people reach Mazed Immo.
 *
 * WhatsApp is the channel: +216 58 415 510, given by the owner on 2026-10-26,
 * for messages only — nobody answers calls on it, so the site never offers to
 * dial it (no tel: link). NEXT_PUBLIC_CONTACT_WHATSAPP overrides it.
 */
export const CONTACT_WHATSAPP = process.env.NEXT_PUBLIC_CONTACT_WHATSAPP?.trim() || "+216 58 415 510";

/** A wa.me link to the support number, with an opening line already typed. */
export function whatsappHref(text?: string, number: string = CONTACT_WHATSAPP): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
