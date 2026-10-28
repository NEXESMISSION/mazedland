/**
 * Where a « Partager » sends an annonce (ShareButton). Pure, so the links are
 * tested without a browser.
 *
 * WhatsApp takes the words and the link together; Facebook takes the link
 * alone and reads the rest from the page's Open Graph tags.
 */
export function shareLinks(text: string, url: string): { whatsapp: string; facebook: string } {
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`.trim())}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  };
}

/**
 * The words that travel with the link: the title, the price when there is one,
 * the place — « Villa S+3 · 450 000 DT · Sfax ». The page's preview shows the
 * photo; this is what a person reads in the chat before tapping.
 */
export function shareText(parts: { title: string; price?: string | null; place?: string | null }): string {
  return [parts.title, parts.price, parts.place]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" · ");
}
