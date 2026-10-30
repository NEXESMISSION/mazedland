import { findCategory } from "./browse";
import { understand, understoodSomething } from "@/lib/search/understand";
import { isMostlyArabic } from "@/lib/search/script";

type Params = Readonly<Record<string, string | undefined>>;

/** The two switches of /admin/settings the decisions below depend on. */
export type RedirectFlags = {
  /** Arabic typed on the French site opens the same search on /ar. */
  arabicRedirect: boolean;
  /** A search typed the way people talk becomes the filters (P3). */
  naturalSearch: boolean;
};

/**
 * Where a catalogue address goes instead, or null when it stays. Three cases,
 * the first that applies wins:
 *
 *   - `via=search`, the page's own search box: its marker and the page number
 *     go; Arabic typed on the French site opens the same search on /ar (the
 *     /ar page sets the language cookie). With the switch off it stays on /fr.
 *   - a search typed the way people talk, « S+2 meublé à louer Tunis 1200 dt »:
 *     once, the words become the filters, so every control on the page shows
 *     what was understood and can be changed. What was not understood stays
 *     the keyword; ?nl=0 searches the words as typed, and `nlq` (the original
 *     words) marks a search already read.
 *   - a category named by its id (the old « Tout voir » links): the same
 *     search written with the slug, so a filter has one address and every chip
 *     and link reads it the same way.
 *
 * Decided in generateMetadata, which Next waits for before the first byte
 * (`htmlLimitedBots` in next.config.ts): thrown from the page body, under the
 * streamed loading shell, the same redirect() arrived as a 200 with a
 * one-second meta refresh that crawlers and link checkers never followed.
 */
export function catalogueRedirect(
  sp: Params,
  locale: string,
  flags: RedirectFlags,
  leaves: readonly { id: string; slug: string }[],
): string | null {
  if (sp.via === "search") {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null && k !== "via" && k !== "page") next.set(k, v);
    const to = locale === "fr" && flags.arabicRedirect && isMostlyArabic(sp.q) ? "ar" : locale;
    return `/${to}/annonces?${next.toString()}`;
  }

  if (flags.naturalSearch && sp.q?.trim() && sp.nl !== "0" && !sp.nlq) {
    const u = understand(sp.q);
    if (understoodSomething(u)) {
      const next = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (v != null && k !== "page" && k !== "q") next.set(k, v);
      // What was just typed wins over the chip already in the URL: a visitor
      // on Sfax who types « villa Tunis » is looking in Tunis. A place or a
      // budget replaces the whole of the old one (its délégation, its other
      // bound), so nothing stale is left to contradict it.
      const put = (k: string, v: string | number | undefined) => {
        if (v != null) next.set(k, String(v));
      };
      if (u.gov) for (const k of ["gov", "del"]) next.delete(k);
      if (u.min != null || u.max != null) for (const k of ["min", "max", "min_price", "max_price"]) next.delete(k);
      put("deal", u.deal);
      put("cat", u.cat);
      put("gov", u.gov);
      put("del", u.del);
      put("rooms", u.rooms);
      put("surface", u.surface);
      put("min", u.min);
      put("max", u.max);
      put("furnished", u.furnished);
      if (u.rest) next.set("q", u.rest);
      next.set("nlq", sp.q.trim().slice(0, 200));
      return `/${locale}/annonces?${next.toString()}`;
    }
  }

  const active = findCategory(sp.cat, leaves);
  if (active && sp.cat !== active.slug) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null) next.set(k, v);
    next.set("cat", active.slug);
    return `/${locale}/annonces?${next.toString()}`;
  }

  return null;
}

/**
 * The address of a page past the last one, or null when the page exists: the
 * same search without `page`, which is the first page — what the page body
 * shows for it anyway (PostgREST refuses a range past the end). A stale
 * bookmark or an indexed `?page=9999` then lands on a real address instead of
 * an indexable duplicate of page 1 with a canonical of its own.
 */
export function pastEndRedirect(sp: Params, locale: string, requested: number, total: number, pageSize: number): string | null {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (requested <= 1 || requested <= last) return null;
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v != null && k !== "page") next.set(k, v);
  const s = next.toString();
  return `/${locale}/annonces${s ? `?${s}` : ""}`;
}
