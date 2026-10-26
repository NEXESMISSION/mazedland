import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { coverPhoto } from "@/lib/listingCover";
import { ListingImage } from "@/components/media/ListingImage";
import { formatNumber, formatTND } from "@/lib/utils";
import { searchTokens } from "@/lib/search";
import { PRICE_BUCKETS, RENT_BUCKETS, TYPE_TO_CATEGORY, findCategory } from "@/lib/catalog/browse";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { BellRing, ChevronDown, ChevronLeft, ChevronRight, Home, ImageOff, MapPin, Ruler, Search, SearchX, SlidersHorizontal, Wallet, X } from "lucide-react";
import { FURNISHED, isoDay, type Furnished } from "@/lib/listings/deal";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { redirect } from "next/navigation";
import { understand, understoodSomething } from "@/lib/search/understand";
import { isMostlyArabic } from "@/lib/search/script";
import { Sparkles } from "lucide-react";
import { getSettings } from "@/lib/settings/server";
import { usableRange } from "@/lib/range";
import { BudgetFields } from "./BudgetFields";

export const dynamic = "force-dynamic";

/**
 * Annonces — the fixed-price catalogue: a price is shown and the buyer
 * telephones the seller.
 *
 * It reads `listings` (0146). Filters are the deal (sale or rent, 0166),
 * category, governorate, keyword, a price range, a minimum surface and number
 * of rooms, and for a rental whether it is furnished and when it is free; the page is written
 * against the shared design tokens, so it takes whichever palette the site
 * defines.
 *
 * PAGINATION. This used to `.limit(60)` and print `rows.length` as the total.
 * Harmless at a dozen annonces, and two bugs the day there are sixty-one: the
 * count under-reports, and everything past the 60th is unreachable because
 * nothing links to it.
 */

/**
 * A repeated query parameter (?q=a&q=b) arrives as an array, and every read
 * below assumes a string — that pair used to crash the page.
 */
function firstValues(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  // The auction-era explore page filtered by property TYPE: /properties?types=villa.
  // Those links are in e-mails, SMS and Google's index; next.config redirects
  // the path here and keeps the query, but this page filters by category, so
  // the type was dropped and every one of them opened the whole catalogue.
  if (!out.cat && out.types) {
    const slug = TYPE_TO_CATEGORY[out.types];
    if (slug) out.cat = slug;
  }
  return out;
}

/** ?deal=sale | rent narrows to one deal; anything else shows both. */
function dealOf(v: string | undefined): "sale" | "rent" | null {
  return v === "sale" || v === "rent" ? v : null;
}

/** The deal tabs, in order; the text is `catalogue.deal.<key>`. */
const DEALS = ["all", "sale", "rent"] as const;

/** "Surface" sorts in JS (the area lives in jsonb), over at most this many. */
const SURFACE_SORT_WINDOW = 500;

type Row = {
  id: string;
  title: string;
  price: number | null;
  price_on_request: boolean;
  negotiable: boolean;
  governorate: string;
  attributes: Record<string, unknown> | null;
  published_at: string | null;
  deal_type: string | null;
  availability: string | null;
  available_from: string | null;
  promo_top_listed?: boolean | null;
  category:
    | { label_fr: string; label_ar: string | null; kind: string }
    | { label_fr: string; label_ar: string | null; kind: string }[]
    | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

type Cat = {
  id: string;
  slug: string;
  label_fr: string;
  label_ar: string | null;
  kind: string;
  parent_id: string | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** Sort keys; the chip text is `catalogue.sort.<key>`. */
const SORTS = ["recent", "cheap", "dear", "big"] as const;

/** Surface is the one number every property is compared on. */
function surfaceOf(a: Record<string, unknown> | null): number | null {
  const v = (a ?? {}).area_sqm;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type CatalogueT = Awaited<ReturnType<typeof getTranslations<"catalogue">>>;

function specLine(r: Row, t: CatalogueT, locale: string): string[] {
  const a = (r.attributes ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const m2 = surfaceOf(r.attributes);
  if (m2) out.push(t("specArea", { area: formatNumber(m2, locale) }));
  if (Number(a.rooms) > 0) out.push(t("specRooms", { count: Number(a.rooms) }));
  if (Number(a.bathrooms) > 0) out.push(t("specBathrooms", { count: Number(a.bathrooms) }));
  return out;
}

// The tab title follows the filters. Every catalogue view used to carry the
// site's home title, so "Terrains à Sfax" and the unfiltered page were the
// same line in a browser tab, a bookmark and a search result.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale }, rawSp] = await Promise.all([params, searchParams]);
  const sp = firstValues(rawSp);
  const t = await getTranslations({ locale, namespace: "catalogue" });
  const admin = getServiceSupabase();
  const deal = dealOf(sp.deal);
  let what = t(deal === "rent" ? "metaTitleRent" : deal === "sale" ? "metaTitleSale" : "metaTitleDefault");
  if (sp.cat && admin) {
    const { data } = await admin
      .from("categories")
      .select("label_fr, label_ar")
      .eq("slug", sp.cat)
      .maybeSingle();
    if (data?.label_fr) what = categoryLabel(data as { label_fr: string; label_ar: string | null }, locale);
  }
  const gov = sp.gov?.trim();
  return {
    title: gov
      ? t("metaTitleIn", { what, governorate: governorateLabel(gov, locale) })
      : t("metaTitleTunisia", { what }),
    // A keyword search is a results page, not a page to put in an index.
    ...(sp.q?.trim() ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function AnnoncesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = firstValues(await searchParams);
  const locale = await getLocale();
  const t = await getTranslations("catalogue");
  const admin = getServiceSupabase();
  const settings = await getSettings();
  // Annonces per page (/admin/settings → Publication).
  const pageSize = settings.catalogue_page_size;

  // The catalogue's own search box (via=search) typed in Arabic on the French
  // site: the same search, in Arabic. The /ar page sets the language cookie.
  // With the switch off, it stays on the French site.
  if (sp.via === "search") {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null && k !== "via" && k !== "page") next.set(k, v);
    if (locale === "fr" && settings.feature_arabic_redirect && isMostlyArabic(sp.q)) redirect(`/ar/annonces?${next.toString()}`);
    redirect(`/${locale}/annonces?${next.toString()}`);
  }

  // A search typed the way people talk (P3): « S+2 meublé à louer Tunis
  // 1200 dt » becomes the filters below — once, through a redirect, so every
  // control on the page shows what was understood and can be changed. What
  // was not understood stays the keyword; ?nl=0 searches the words as typed,
  // and `nlq` (the original words) marks a search already read. Switched off,
  // every search is the plain keyword search.
  if (settings.feature_natural_search && sp.q?.trim() && sp.nl !== "0" && !sp.nlq) {
    const u = understand(sp.q);
    if (understoodSomething(u)) {
      const next = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (v != null && k !== "page" && k !== "q") next.set(k, v);
      const put = (k: string, v: string | number | undefined) => {
        if (v != null && !next.has(k)) next.set(k, String(v));
      };
      put("deal", u.deal);
      put("cat", u.cat);
      put("gov", u.gov);
      put("rooms", u.rooms);
      put("surface", u.surface);
      put("min", u.min);
      put("max", u.max);
      put("furnished", u.furnished);
      if (u.rest) next.set("q", u.rest);
      next.set("nlq", sp.q.trim().slice(0, 200));
      redirect(`/${locale}/annonces?${next.toString()}`);
    }
  }

  const sort = (SORTS.find((s) => s === sp.sort) ?? "recent") as string;
  const deal = dealOf(sp.deal);
  // A rent is a monthly figure: its brackets are in hundreds, not thousands.
  const buckets = deal === "rent" ? RENT_BUCKETS : PRICE_BUCKETS;

  // Price range, in TND. `min_price` / `max_price` are the names the home
  // page's price tiles sent before they pointed here; they are still read so a
  // shared or bookmarked link filters instead of silently showing everything.
  const positive = (v: string | undefined) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const minAsked = positive(sp.min ?? sp.min_price);
  const maxAsked = positive(sp.max ?? sp.max_price);
  // A minimum above the maximum matches nothing: it is not applied, and the
  // budget opens on the two numbers with the reason (src/lib/range.ts),
  // instead of « 0 bien » under a chip reading « 500 000 – 100 000 TND ».
  const { min, max, inverted: priceInverted } = usableRange(minAsked, maxAsked);
  // « Plus de filtres ». Surface and rooms live in `attributes`, which the
  // wizard requires for every category that has them, so a hard minimum loses
  // nothing. Furnished and the date only mean something for a rental.
  const surface = positive(sp.surface);
  const roomsMin = (() => {
    const n = Math.floor(Number(sp.rooms));
    return n >= 1 && n <= 10 ? n : null;
  })();
  const furnished: Furnished | null =
    deal === "rent" && (FURNISHED as readonly string[]).includes(sp.furnished ?? "")
      ? (sp.furnished as Furnished)
      : null;
  const availBy = deal === "rent" ? isoDay(sp.avail) : null;
  const moreActive = Boolean(surface || roomsMin || furnished || availBy);
  const requestedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);

  if (!admin) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-[13px] text-muted">{t("unavailable")}</p>
      </main>
    );
  }

  const { data: catRows } = await admin
    .from("categories")
    .select("id, slug, label_fr, label_ar, kind, parent_id")
    .eq("is_active", true)
    .order("sort_order");
  const cats = (catRows ?? []) as Cat[];
  const leaves = cats.filter((c) => c.parent_id);
  const active = findCategory(sp.cat, leaves);
  // A category named by its id (the old « Tout voir » links) goes to the same
  // search written with the slug, so a filter has one address and every chip
  // and link below reads it the same way.
  if (active && sp.cat !== active.slug) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null) next.set(k, v);
    next.set("cat", active.slug);
    redirect(`/${locale}/annonces?${next.toString()}`);
  }

  let q = admin
    .from("listings")
    .select(
      `id, title, price, price_on_request, negotiable, governorate, attributes, published_at,
       deal_type, availability, available_from,
       category:categories (label_fr, label_ar, kind),
       promo_top_listed,
       photos:listing_photos (storage_path, sort_order)`,
      { count: "exact" },
    )
    .eq("status", "published");

  if (deal) q = q.eq("deal_type", deal);
  if (active) q = q.eq("category_id", active.id);
  if (sp.gov) q = q.eq("governorate", sp.gov);
  // One ILIKE per word, against the accent-folded column: every word has to
  // appear, in any order. See searchTokens.
  for (const token of searchTokens(sp.q)) q = q.ilike("search_text", `%${token}%`);
  if (min) q = q.gte("price", min);
  if (max) q = q.lte("price", max);
  // jsonb numbers compare as numbers through the arrow operator.
  if (surface) q = q.gte("attributes->area_sqm", surface);
  if (roomsMin) q = q.gte("attributes->rooms", roomsMin);
  if (furnished) q = q.eq("furnished", furnished);
  // Free by that date — or the owner did not say: those stay in, flagged on
  // the card as not confirmed rather than silently dropped or silently passed.
  if (availBy) q = q.or(`available_from.is.null,available_from.lte.${availBy}`);

  if (sort === "cheap") q = q.order("price", { ascending: true, nullsFirst: false });
  else if (sort === "dear") q = q.order("price", { ascending: false, nullsFirst: false });
  // The default order puts the paid « Top de la recherche » first (0156); the
  // expiry job clears the flag when the period ends.
  else q = q.order("promo_top_listed", { ascending: false }).order("published_at", { ascending: false });
  // A unique last key. Bulk approval stamps a whole batch with the same
  // published_at and prices tie, so without it the order was undefined between
  // pages: one annonce could show up on both, another on neither.
  q = q.order("id", { ascending: true });

  let rows: Row[];
  let total: number;
  let page = requestedPage;

  if (sort === "big") {
    // Surface lives in the jsonb, so it is sorted here rather than in SQL — at
    // catalogue size that is cheaper than an expression index nothing else
    // uses. The whole (bounded) set is sorted first and THEN paged; sorting one
    // page at a time would put the largest bien of page 2 below the smallest of
    // page 1.
    const { data, count } = await q.limit(SURFACE_SORT_WINDOW);
    const all = ((data ?? []) as unknown as Row[])
      .slice()
      .sort((a, b) => (surfaceOf(b.attributes) ?? 0) - (surfaceOf(a.attributes) ?? 0));
    total = count ?? all.length;
    page = Math.min(page, Math.max(1, Math.ceil(all.length / pageSize)));
    rows = all.slice((page - 1) * pageSize, page * pageSize);
  } else {
    const from = (page - 1) * pageSize;
    let res = await q.range(from, from + pageSize - 1);
    // A page past the end — a stale bookmark, an indexed link, or annonces that
    // have expired since — makes PostgREST refuse the range. `count` then came
    // back null, so the page printed "0 bien" with no pager to escape with.
    if (res.error && page > 1) {
      page = 1;
      res = await q.range(0, pageSize - 1);
    }
    rows = (res.data ?? []) as unknown as Row[];
    total = res.count ?? rows.length;
  }
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const { data: govRows } = await admin
    .from("listings")
    .select("governorate")
    .eq("status", "published");
  const govs = [...new Set((govRows ?? []).map((g) => g.governorate as string))].sort();

  // What the Budget row reads when it is closed — the whole state of the
  // filter in one line, so it does not have to be opened to be understood.
  const priceLabel =
    min && max
      ? t("priceBetween", { min: formatTND(min, locale), max: formatTND(max, locale) })
      : min
        ? t("priceFrom", { min: formatTND(min, locale) })
        : max
          ? t("priceUpTo", { max: formatTND(max, locale) })
          : null;

  // « Plus de filtres » closed, in one line.
  const moreChips = [
    surface ? t("surfaceChip", { area: formatNumber(surface, locale) }) : null,
    roomsMin ? t("roomsChip", { count: roomsMin }) : null,
    furnished ? t(`furnished.${furnished}`) : null,
    availBy ? t("availChip", { date: availBy.split("-").reverse().join("/") }) : null,
  ].filter((x): x is string => Boolean(x));

  // The phone's « Filtrer » row: everything the folded panel has set — a
  // budget to correct first, where the truncation cannot hide it.
  const filterSummary = [
    priceInverted ? t("filtersBudgetToFix") : null,
    active ? categoryLabel(active, locale) : null,
    sp.gov ? governorateLabel(sp.gov, locale) : null,
    priceLabel,
    ...moreChips,
    sort !== "recent" ? t(`sort.${sort}`) : null,
  ].filter((x): x is string => Boolean(x));

  const qs = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    // `page` is deliberately absent from the defaults: changing any filter
    // returns to page 1, and only the pager passes a page explicitly.
    const merged = {
      deal: deal ?? undefined, cat: sp.cat, gov: sp.gov, sort: sp.sort, q: sp.q,
      min: min ? String(min) : undefined, max: max ? String(max) : undefined,
      surface: surface ? String(surface) : undefined,
      rooms: roomsMin ? String(roomsMin) : undefined,
      furnished: furnished ?? undefined,
      avail: availBy ?? undefined,
      ...next,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/annonces${s ? `?${s}` : ""}`;
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-6 pt-4 lg:px-6 lg:pb-10 lg:pt-6">
      {/* No visible title. An eyebrow, a 32px headline and a strapline took
          180px — a third of a phone screen — to tell a visitor who tapped
          « Explorer » that they are looking at things for sale. The filters
          and the first row of results are the heading. The h1 stays for
          assistive tech and search engines. */}
      <h1 className="sr-only">{t("heading")}</h1>

      {/* Keyword search for phones. The header search is desktop-only, so a
          phone could reach the catalogue but never search it. A plain GET form:
          it works before hydration and carries the active filters along. */}
      <form action={`/${locale}/annonces`} method="get" role="search" className="relative lg:hidden">
        <input type="hidden" name="via" value="search" />
        {deal && <input type="hidden" name="deal" value={deal} />}
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        {sp.gov && <input type="hidden" name="gov" value={sp.gov} />}
        {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        {min ? <input type="hidden" name="min" value={String(min)} /> : null}
        {max ? <input type="hidden" name="max" value={String(max)} /> : null}
        {surface ? <input type="hidden" name="surface" value={String(surface)} /> : null}
        {roomsMin ? <input type="hidden" name="rooms" value={String(roomsMin)} /> : null}
        {furnished && <input type="hidden" name="furnished" value={furnished} />}
        {availBy && <input type="hidden" name="avail" value={availBy} />}
        <Search
          aria-hidden
          className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted"
          strokeWidth={2}
        />
        {/* 16px text: iOS zooms the whole page into any smaller input on focus.
            Keyed on `q`: clearing the search, a link or the back button is a
            client navigation, and an uncontrolled input that has been typed
            in would otherwise keep the old words. */}
        <input
          key={sp.q ?? ""}
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          enterKeyHint="search"
          className="h-11 w-full rounded-full border border-border bg-surface-2 pe-4 ps-11 text-[16px] text-foreground outline-none transition placeholder:text-muted focus:border-gold-soft focus:bg-surface"
        />
      </form>

      {/* Buy or rent first: the one question that changes every other filter
          (a rent is per month, its budget is in hundreds). Changing it clears
          the price, which belongs to the other deal's scale. */}
      <div role="tablist" aria-label={t("dealAria")} className="mt-5 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1 sm:inline-grid sm:w-auto">
        {DEALS.map((k) => {
          const on = (deal ?? "all") === k;
          return (
            <Link
              key={k}
              role="tab"
              aria-selected={on}
              href={qs({
                deal: k === "all" ? undefined : k,
                min: undefined,
                max: undefined,
                // Rental-only filters do not follow the visitor to the sales.
                furnished: k === "rent" ? furnished ?? undefined : undefined,
                avail: k === "rent" ? availBy ?? undefined : undefined,
              }) as never}
              className={
                "inline-flex h-9 items-center justify-center rounded-lg px-4 text-[13px] font-bold transition " +
                (on ? "bg-[var(--gold)] text-white shadow-[var(--shadow-gold)]" : "text-muted hover:text-foreground")
              }
            >
              {t(`deal.${k}`)}
            </Link>
          );
        })}
      </div>

      {/* ── Filtrer, on a phone ──────────────────────────────────────────
          At 390 px the categories, the places, the sort and the two panels
          below took the whole first screen before a single annonce. On a phone
          they fold behind one row that says what is set; a desktop has the
          room and always shows them. A checkbox and its label rather than a
          script: like everything else here, it opens before any JavaScript
          has run. Open on arrival when the budget needs correcting. */}
      <input
        type="checkbox"
        id="catalogue-filters"
        defaultChecked={priceInverted}
        aria-controls="catalogue-filters-panel"
        className="peer sr-only lg:hidden"
      />
      <label
        htmlFor="catalogue-filters"
        className="tap-target mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-2.5 peer-checked:[&_.chevron]:rotate-180 peer-focus-visible:ring-2 peer-focus-visible:ring-gold-soft lg:hidden"
      >
        <span className="inline-flex shrink-0 items-center gap-2 text-[12.5px] font-bold text-foreground">
          <SlidersHorizontal className="size-4 text-muted" strokeWidth={2} />
          {t("filtersToggle")}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-end text-[11.5px] font-semibold ${
            priceInverted ? "text-[var(--danger)]" : filterSummary.length ? "text-gold" : "text-muted"
          }`}
        >
          {filterSummary.length ? filterSummary.join(" · ") : t("filtersNone")}
        </span>
        <ChevronDown className="chevron size-4 shrink-0 text-muted transition" strokeWidth={2} />
      </label>

      <div id="catalogue-filters-panel" className="hidden peer-checked:block lg:block">
        {/* Filters. Property is filtered by what it IS and where it is — the two
            questions a buyer actually starts from. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={qs({ cat: undefined }) as never}
            className={
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition " +
              (!active
                ? "bg-foreground text-[var(--background)]"
                : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
            }
          >
            {t("allCategories")}
          </Link>
          {leaves.map((c) => (
            <Link
              key={c.id}
              href={qs({ cat: c.slug }) as never}
              className={
                "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition " +
                (active?.slug === c.slug
                  ? "bg-foreground text-[var(--background)]"
                  : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
              }
            >
              {categoryLabel(c, locale)}
            </Link>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={qs({ gov: undefined }) as never}
            className={
              "whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition " +
              (!sp.gov
                ? "bg-foreground text-[var(--background)]"
                : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
            }
          >
            {t("allTunisia")}
          </Link>
          {govs.map((g) => (
            <Link
              key={g}
              href={qs({ gov: g }) as never}
              className={
                "whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition " +
                (sp.gov === g
                  ? "bg-foreground text-[var(--background)]"
                  : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
              }
            >
              {governorateLabel(g, locale)}
            </Link>
          ))}

          {/* `flex-wrap`, not `inline-flex`. As bare text these four fitted a
              phone row; as chips they do not, and an `inline-flex` cannot break —
              so « Surface » was cut off at the right edge with no way to reach it. */}
          <span className="ms-auto flex flex-wrap items-center gap-1.5">
            {SORTS.map((s) => (
              <Link
                key={s}
                href={qs({ sort: s }) as never}
                className={
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition " +
                  (sort === s
                    ? "bg-foreground text-[var(--background)]"
                    : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
                }
              >
                {t(`sort.${s}`)}
              </Link>
            ))}
          </span>
        </div>

        {/* ── Budget ───────────────────────────────────────────────────────
            The catalogue already filtered on `min`/`max` — the home page's
            brackets link straight into it — but nothing here could set them.
            A buyer arriving from the nav or from Google could narrow by type
            and by governorate, and not by price.

            A <details> with a GET form inside: it opens, applies and clears
            before any JavaScript has run, which is also what the keyword
            search above it does. */}
        <details open={priceInverted} className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
          <summary className="tap-target flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold text-foreground">
              <Wallet className="size-4 text-muted" strokeWidth={2} />
              {t(deal === "rent" ? "budgetRent" : "budget")}
            </span>
            <span
              className={`mazed-tabular text-[11.5px] font-semibold ${
                priceInverted ? "text-[var(--danger)]" : priceLabel ? "text-gold" : "text-muted"
              }`}
            >
              {priceInverted ? t("budgetToFix") : priceLabel ?? t("allPrices")}
            </span>
          </summary>

          <div className="border-t border-border p-3">
            <div className="flex flex-wrap gap-1.5">
              {buckets.map((b) => {
                const on = (b.min ?? 0) === (min ?? 0) && (b.max ?? 0) === (max ?? 0);
                return (
                  <Link
                    key={b.key}
                    href={qs({
                      min: b.min ? String(b.min) : undefined,
                      max: b.max ? String(b.max) : undefined,
                    }) as never}
                    className={
                      "tap-target whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition " +
                      (on
                        ? "bg-foreground text-[var(--background)]"
                        : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
                    }
                  >
                    {t(deal === "rent" ? `rentBuckets.${b.key}` : `priceBuckets.${b.key}`)}
                  </Link>
                );
              })}
              {(min || max || priceInverted) && (
                <Link
                  href={qs({ min: undefined, max: undefined }) as never}
                  className="tap-target inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-muted transition hover:text-foreground"
                >
                  <X className="size-3" strokeWidth={2.5} /> {t("allPrices")}
                </Link>
              )}
            </div>

            {/* An exact bracket, for someone whose budget is not one of four. */}
            <form
              action={`/${locale}/annonces`}
              method="get"
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
            >
              {deal && <input type="hidden" name="deal" value={deal} />}
              {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
              {sp.gov && <input type="hidden" name="gov" value={sp.gov} />}
              {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
              {sp.q && <input type="hidden" name="q" value={sp.q} />}
              {surface ? <input type="hidden" name="surface" value={String(surface)} /> : null}
              {roomsMin ? <input type="hidden" name="rooms" value={String(roomsMin)} /> : null}
              {furnished && <input type="hidden" name="furnished" value={furnished} />}
              {availBy && <input type="hidden" name="avail" value={availBy} />}
              {/* Keyed on the address: a bracket chip or « Tous les prix » is a
                  client navigation, and the numbers must follow it. */}
              <BudgetFields
                key={`${minAsked ?? ""}-${maxAsked ?? ""}`}
                defaultMin={minAsked ? String(minAsked) : ""}
                defaultMax={maxAsked ? String(maxAsked) : ""}
                minLabel={t("minLabel")}
                maxLabel={t("maxLabel")}
                maxPlaceholder={t("maxPlaceholder")}
                step={deal === "rent" ? 50 : 1000}
                invertedMessage={t("rangeInverted")}
              />
              <button
                type="submit"
                className="mazed-btn-luxe tap-target h-11 shrink-0 px-4 text-[12.5px]"
              >
                {t("apply")}
              </button>
            </form>
          </div>
        </details>

        {/* ── Plus de filtres ───────────────────────────────────────────────
            Same shape as the budget: a GET form in a <details>, working before
            any JavaScript. Open on arrival when one of its filters is set. */}
        <details open={moreActive} className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
          <summary className="tap-target flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold text-foreground">
              <SlidersHorizontal className="size-4 text-muted" strokeWidth={2} />
              {t("moreFilters")}
            </span>
            <span className={`text-[11.5px] font-semibold ${moreActive ? "text-gold" : "text-muted"}`}>
              {moreActive ? moreChips.join(" · ") : t("moreNone")}
            </span>
          </summary>

          <form
            action={`/${locale}/annonces`}
            method="get"
            className="grid gap-3 border-t border-border p-3 sm:grid-cols-2"
          >
            {deal && <input type="hidden" name="deal" value={deal} />}
            {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
            {sp.gov && <input type="hidden" name="gov" value={sp.gov} />}
            {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            {min ? <input type="hidden" name="min" value={String(min)} /> : null}
            {max ? <input type="hidden" name="max" value={String(max)} /> : null}

            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {t("surfaceMin")}
              <input
                type="number"
                name="surface"
                min={0}
                step={10}
                inputMode="numeric"
                defaultValue={surface ? String(surface) : ""}
                placeholder="100"
                className="mazed-tabular mt-1 h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-[16px] font-bold text-foreground outline-none transition placeholder:font-normal placeholder:text-muted focus:border-gold-soft focus:bg-surface"
              />
            </label>

            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {t("roomsMin")}
              <select
                name="rooms"
                defaultValue={roomsMin ? String(roomsMin) : ""}
                className="mt-1 h-11 w-full appearance-none rounded-xl border border-border bg-surface-2 px-3 text-[15px] font-bold text-foreground outline-none focus:border-gold-soft"
              >
                <option value="">{t("anyValue")}</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{t("roomsAtLeast", { count: n })}</option>
                ))}
              </select>
            </label>

            {deal === "rent" && (
              <>
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  {t("furnishedLabel")}
                  <select
                    name="furnished"
                    defaultValue={furnished ?? ""}
                    className="mt-1 h-11 w-full appearance-none rounded-xl border border-border bg-surface-2 px-3 text-[15px] font-bold text-foreground outline-none focus:border-gold-soft"
                  >
                    <option value="">{t("anyValue")}</option>
                    {FURNISHED.map((f) => (
                      <option key={f} value={f}>{t(`furnished.${f}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  {t("availBy")}
                  <input
                    type="date"
                    name="avail"
                    defaultValue={availBy ?? ""}
                    className="mt-1 h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-[15px] font-bold text-foreground outline-none focus:border-gold-soft"
                  />
                </label>
              </>
            )}

            <div className="flex items-center gap-2 sm:col-span-2">
              <button type="submit" className="mazed-btn-luxe tap-target h-11 px-5 text-[12.5px]">
                {t("apply")}
              </button>
              {moreActive && (
                <Link
                  href={qs({ surface: undefined, rooms: undefined, furnished: undefined, avail: undefined }) as never}
                  className="tap-target inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-muted transition hover:text-foreground"
                >
                  <X className="size-3" strokeWidth={2.5} /> {t("clearMore")}
                </Link>
              )}
            </div>
          </form>
        </details>
      </div>

      {settings.feature_natural_search && sp.nlq && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-gold-faint px-3 py-2 text-[12.5px] text-foreground ring-1 ring-gold-soft">
          <Sparkles className="size-3.5 shrink-0 text-gold" />
          <span>{t("understood", { query: sp.nlq })}</span>
          <Link href={`/annonces?q=${encodeURIComponent(sp.nlq)}&nl=0` as never} className="font-bold text-gold underline-offset-2 hover:underline">
            {t("searchAsTyped")}
          </Link>
        </p>
      )}

      <p className="mt-4 text-[12.5px] text-muted">
        {t("resultCount", { count: total })}
        {sp.q?.trim() && (
          <Link
            href={qs({ q: undefined }) as never}
            aria-label={t("clearSearch", { query: sp.q.trim() })}
            className="ms-2 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 font-semibold text-foreground ring-1 ring-border transition hover:ring-gold-soft"
          >
            {t("queryChip", { query: sp.q.trim() })}
            <X className="size-3" />
          </Link>
        )}
        {active ? ` · ${categoryLabel(active, locale)}` : ""}
        {sp.gov ? ` · ${governorateLabel(sp.gov, locale)}` : ""}
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface-2/40 p-10 text-center">
          <SearchX className="mx-auto size-6 text-muted" />
          <p className="mt-3 text-[13.5px] font-bold text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-[12.5px] text-muted">{t("emptyBody")}</p>
          {/* A way out. Seven of the eight category chips are empty at this
              catalogue size, and this state used to be text only. */}
          {(sp.cat || sp.gov || sp.q || min || max || moreActive || deal) && (
            <Link
              href={"/annonces" as never}
              className="tap-target mt-4 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-bold text-[var(--background)]"
            >
              <X className="size-3.5" /> {t("clearFilters")}
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
          {rows.map((r, i) => {
            const cat = one(r.category);
            const cover = coverPhoto(r.photos);
            const specs = specLine(r, t, locale);
            return (
              <li key={r.id} className="relative">
                {/* Outside the card link: a button cannot sit inside an <a>. */}
                <div className="absolute end-2 top-2 z-10">
                  <CompareToggle listingId={r.id} />
                </div>
                <Link
                  href={`/annonces/${r.id}` as never}
                  className="group block overflow-hidden rounded-2xl border border-border bg-surface transition hover:border-gold-soft hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)]"
                >
                  <div className="relative aspect-[4/3] bg-surface-2">
                    {cover ? (
                      <ListingImage
                        path={cover.storage_path}
                        alt={r.title}
                        sizes="(min-width:1024px) 260px, 45vw"
                        priority={i < 4}
                        className="transition duration-500 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <span className="grid size-full place-items-center text-muted">
                        <ImageOff className="size-6" />
                      </span>
                    )}
                  </div>

                  <div className="p-3">
                    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                      <Home className="size-3" /> {categoryLabel(cat, locale)}
                      {r.deal_type === "rent" && (
                        <span className="ms-1 rounded-full bg-gold-faint px-1.5 py-0.5 text-gold">{t("forRent")}</span>
                      )}
                      {r.promo_top_listed && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-foreground ring-1 ring-border">{t("promoted")}</span>
                      )}
                      {r.availability === "reserved" && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-amber-600">{t("reserved")}</span>
                      )}
                    </span>
                    <h2 dir="auto" className="mt-0.5 line-clamp-2 break-words text-[13.5px] font-bold leading-snug text-foreground">
                      {r.title}
                    </h2>

                    <p className="mazed-tabular mt-1.5 text-[15px] font-extrabold text-foreground">
                      {r.price_on_request || r.price == null
                        ? t("priceOnRequest")
                        : t(r.deal_type === "rent" ? "rentAmount" : "priceAmount", {
                            amount: formatTND(Number(r.price), locale),
                          })}
                      {r.negotiable && !r.price_on_request && (
                        <span className="ms-1.5 text-[10.5px] font-bold text-muted">{t("negotiable")}</span>
                      )}
                    </p>

                    {/* One wrapping row. These were two inline-flex paragraphs,
                        which sit side by side with nothing between them when
                        they fit: "200 m²◎ Sfax". */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted">
                      {specs.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Ruler className="size-3" /> {specs.join(" · ")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" /> {governorateLabel(r.governorate, locale)}
                      </span>
                    </div>
                    {/* Kept in by the « libre avant » filter because the owner gave
                        no date: say so, rather than let it pass as a match. */}
                    {availBy && r.deal_type === "rent" && !r.available_from && (
                      <p className="mt-1 text-[10.5px] font-semibold text-amber-600">{t("availUnconfirmed")}</p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Nothing here, or nothing right: keep the search as a demande and be
          told when it is answered (0168). Same filters, nothing to retype —
          the words too: the form keeps them in « Autres souhaits » and says
          they are not a criterion (src/lib/requests/prefill.ts). */}
      {settings.feature_requests && (
        <section className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-gold-soft bg-gold-faint p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[14px] font-extrabold text-foreground">{t("requestCtaTitle")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("requestCtaBody")}</p>
          </div>
          <Link
            href={qs({ sort: undefined }).replace("/annonces", "/demandes/nouvelle") as never}
            className="mazed-btn-luxe tap-target inline-flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-[13px]"
          >
            <BellRing className="size-4" /> {t("requestCta")}
          </Link>
        </section>
      )}

      {lastPage > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label={t("pagination")}>
          {page > 1 ? (
            <Link
              href={qs({ page: page - 1 > 1 ? String(page - 1) : undefined }) as never}
              className="tap-target inline-flex items-center gap-1 rounded-full bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/30"
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" /> {t("previous")}
            </Link>
          ) : (
            <span aria-hidden className="w-[108px]" />
          )}
          <span className="mazed-tabular px-2 text-[12.5px] font-semibold text-muted">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link
              href={qs({ page: String(page + 1) }) as never}
              className="tap-target inline-flex items-center gap-1 rounded-full bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/30"
            >
              {t("next")} <ChevronRight className="size-4 rtl:-scale-x-100" />
            </Link>
          ) : (
            <span aria-hidden className="w-[108px]" />
          )}
        </nav>
      )}
    </main>
  );
}
