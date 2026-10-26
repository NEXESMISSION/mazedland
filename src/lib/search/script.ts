/**
 * Which script a search is typed in. Someone who searches in Arabic on the
 * French site is answered in Arabic (the owner's ask, 2026-10-26): the search
 * box opens the /ar catalogue and the choice is remembered, like the FR / ع
 * switch. A Latin word or a number alongside (« S+2 », « 300 ») does not stop
 * it; mostly-Latin text with one Arabic name does not trigger it.
 */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/g;
const LATIN = /[A-Za-zÀ-ÿ]/g;

export function isMostlyArabic(text: string | null | undefined): boolean {
  if (!text) return false;
  const arabic = (text.match(ARABIC) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  return arabic >= 2 && arabic > latin;
}
