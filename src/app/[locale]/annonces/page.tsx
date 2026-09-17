import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { coverPhoto } from "@/lib/listingCover";
import { ListingImage } from "@/components/media/ListingImage";
import { formatNumber, formatTND } from "@/lib/utils";
import { searchTokens } from "@/lib/search";
import { TYPE_TO_CATEGORY } from "@/lib/catalog/browse";
import { ChevronLeft, ChevronRight, Home, ImageOff, MapPin, Ruler, Search, SearchX, X } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Annonces — the fixed-price catalogue: a price is shown and the buyer
 * telephones the seller.
 *
 * It reads `listings` (0146). Filters are category, governorate, keyword and a
 * price range; the page is written against the shared design tokens, so it
 * takes whichever palette the site defines.
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

/** Annonces per page — four rows of the desktop grid. */
const PAGE_SIZE = 24;

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
  category: { label_fr: string; kind: string } | { label_fr: string; kind: string }[] | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

type Cat = { id: string; slug: string; label_fr: string; kind: string; parent_id: string | null };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

const SORTS = [
  { key: "recent", label: "Plus récentes" },
  { key: "cheap", label: "Prix croissant" },
  { key: "dear", label: "Prix décroissant" },
  { key: "big", label: "Surface" },
] as const;

/** Surface is the one number every property is compared on. */
function surfaceOf(a: Record<string, unknown> | null): number | null {
  const v = (a ?? {}).area_sqm;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function specLine(r: Row): string[] {
  const a = (r.attributes ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const m2 = surfaceOf(r.attributes);
  if (m2) out.push(`${formatNumber(m2)} m²`);
  if (Number(a.rooms) > 0) out.push(`${a.rooms} pièces`);
  if (Number(a.bathrooms) > 0) out.push(`${a.bathrooms} SdB`);
  return out;
}

// The tab title follows the filters. Every catalogue view used to carry the
// site's home title, so "Terrains à Sfax" and the unfiltered page were the
// same line in a browser tab, a bookmark and a search result.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = firstValues(await searchParams);
  const admin = getServiceSupabase();
  let what = "Annonces immobilières";
  if (sp.cat && admin) {
    const { data } = await admin.from("categories").select("label_fr").eq("slug", sp.cat).maybeSingle();
    if (data?.label_fr) what = data.label_fr as string;
  }
  const where = sp.gov?.trim() ? ` à ${sp.gov.trim()}` : " en Tunisie";
  return {
    title: `${what}${where} — Mazed Immo`,
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
  const admin = getServiceSupabase();

  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? "recent") as string;

  // Price range, in TND. `min_price` / `max_price` are the names the home
  // page's price tiles sent before they pointed here; they are still read so a
  // shared or bookmarked link filters instead of silently showing everything.
  const positive = (v: string | undefined) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const min = positive(sp.min ?? sp.min_price);
  const max = positive(sp.max ?? sp.max_price);
  const requestedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);

  if (!admin) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-[13px] text-muted">Service indisponible.</p>
      </main>
    );
  }

  const { data: catRows } = await admin
    .from("categories")
    .select("id, slug, label_fr, kind, parent_id")
    .eq("is_active", true)
    .order("sort_order");
  const cats = (catRows ?? []) as Cat[];
  const leaves = cats.filter((c) => c.parent_id);
  const active = leaves.find((c) => c.slug === sp.cat) ?? null;

  let q = admin
    .from("listings")
    .select(
      `id, title, price, price_on_request, negotiable, governorate, attributes, published_at,
       category:categories (label_fr, kind),
       photos:listing_photos (storage_path, sort_order)`,
      { count: "exact" },
    )
    .eq("status", "published");

  if (active) q = q.eq("category_id", active.id);
  if (sp.gov) q = q.eq("governorate", sp.gov);
  // One ILIKE per word, against the accent-folded column: every word has to
  // appear, in any order. See searchTokens.
  for (const token of searchTokens(sp.q)) q = q.ilike("search_text", `%${token}%`);
  if (min) q = q.gte("price", min);
  if (max) q = q.lte("price", max);

  if (sort === "cheap") q = q.order("price", { ascending: true, nullsFirst: false });
  else if (sort === "dear") q = q.order("price", { ascending: false, nullsFirst: false });
  else q = q.order("published_at", { ascending: false });
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
    page = Math.min(page, Math.max(1, Math.ceil(all.length / PAGE_SIZE)));
    rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    const from = (page - 1) * PAGE_SIZE;
    let res = await q.range(from, from + PAGE_SIZE - 1);
    // A page past the end — a stale bookmark, an indexed link, or annonces that
    // have expired since — makes PostgREST refuse the range. `count` then came
    // back null, so the page printed "0 bien" with no pager to escape with.
    if (res.error && page > 1) {
      page = 1;
      res = await q.range(0, PAGE_SIZE - 1);
    }
    rows = (res.data ?? []) as unknown as Row[];
    total = res.count ?? rows.length;
  }
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: govRows } = await admin
    .from("listings")
    .select("governorate")
    .eq("status", "published");
  const govs = [...new Set((govRows ?? []).map((g) => g.governorate as string))].sort();

  const qs = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    // `page` is deliberately absent from the defaults: changing any filter
    // returns to page 1, and only the pager passes a page explicitly.
    const merged = {
      cat: sp.cat, gov: sp.gov, sort: sp.sort, q: sp.q,
      min: min ? String(min) : undefined, max: max ? String(max) : undefined,
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
      <h1 className="sr-only">Biens à prix fixe — annonces immobilières</h1>

      {/* Keyword search for phones. The header search is desktop-only, so a
          phone could reach the catalogue but never search it. A plain GET form:
          it works before hydration and carries the active filters along. */}
      <form action={`/${locale}/annonces`} method="get" role="search" className="relative lg:hidden">
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        {sp.gov && <input type="hidden" name="gov" value={sp.gov} />}
        {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        {min ? <input type="hidden" name="min" value={String(min)} /> : null}
        {max ? <input type="hidden" name="max" value={String(max)} /> : null}
        <Search
          aria-hidden
          className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted"
          strokeWidth={2}
        />
        {/* 16px text: iOS zooms the whole page into any smaller input on focus. */}
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Rechercher un bien, un lieu…"
          aria-label="Rechercher dans les annonces"
          enterKeyHint="search"
          className="h-11 w-full rounded-full border border-border bg-surface-2 pe-4 ps-11 text-[16px] text-foreground outline-none transition placeholder:text-muted focus:border-gold-soft focus:bg-surface"
        />
      </form>

      {/* Filters. Property is filtered by what it IS and where it is — the two
          questions a buyer actually starts from. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={qs({ cat: undefined }) as never}
          className={
            "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition " +
            (!active
              ? "bg-foreground text-[var(--background)]"
              : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
          }
        >
          Tout
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
            {c.label_fr}
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
          Toute la Tunisie
        </Link>
        {(min || max) && (
          <Link
            href={qs({ min: undefined, max: undefined }) as never}
            aria-label="Retirer le filtre de prix"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-[11.5px] font-semibold text-[var(--background)] transition"
          >
            {min && max
              ? `${formatTND(min, locale)} – ${formatTND(max, locale)} TND`
              : min
                ? `À partir de ${formatTND(min, locale)} TND`
                : `Jusqu'à ${formatTND(max!, locale)} TND`}
            <X className="size-3" strokeWidth={2.5} />
          </Link>
        )}
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
            {g}
          </Link>
        ))}

        {/* `flex-wrap`, not `inline-flex`. As bare text these four fitted a
            phone row; as chips they do not, and an `inline-flex` cannot break —
            so « Surface » was cut off at the right edge with no way to reach it. */}
        <span className="ms-auto flex flex-wrap items-center gap-1.5">
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={qs({ sort: s.key }) as never}
              className={
"whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition " +
                (sort === s.key
                  ? "bg-foreground text-[var(--background)]"
                  : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground")
              }
            >
              {s.label}
            </Link>
          ))}
        </span>
      </div>

      <p className="mt-4 text-[12.5px] text-muted">
        {total} bien{total > 1 ? "s" : ""}
        {sp.q?.trim() && (
          <Link
            href={qs({ q: undefined }) as never}
            aria-label={`Effacer la recherche « ${sp.q.trim()} »`}
            className="ms-2 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 font-semibold text-foreground ring-1 ring-border transition hover:ring-gold-soft"
          >
            « {sp.q.trim()} »
            <X className="size-3" />
          </Link>
        )}
        {active ? ` · ${active.label_fr}` : ""}
        {sp.gov ? ` · ${sp.gov}` : ""}
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface-2/40 p-10 text-center">
          <SearchX className="mx-auto size-6 text-muted" />
          <p className="mt-3 text-[13.5px] font-bold text-foreground">Aucun bien ne correspond.</p>
          <p className="mt-1 text-[12.5px] text-muted">
            Élargissez la recherche, le budget ou le gouvernorat.
          </p>
          {/* A way out. Seven of the eight category chips are empty at this
              catalogue size, and this state used to be text only. */}
          {(sp.cat || sp.gov || sp.q || min || max) && (
            <Link
              href={"/annonces" as never}
              className="tap-target mt-4 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-bold text-[var(--background)]"
            >
              <X className="size-3.5" /> Effacer les filtres
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
          {rows.map((r, i) => {
            const cat = one(r.category);
            const cover = coverPhoto(r.photos);
            const specs = specLine(r);
            return (
              <li key={r.id}>
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
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                      <Home className="size-3" /> {cat?.label_fr ?? ""}
                    </span>
                    <h2 dir="auto" className="mt-0.5 line-clamp-2 break-words text-[13.5px] font-bold leading-snug text-foreground">
                      {r.title}
                    </h2>

                    <p className="mazed-tabular mt-1.5 text-[15px] font-extrabold text-foreground">
                      {r.price_on_request || r.price == null
                        ? "Prix sur demande"
                        : `${formatTND(Number(r.price), locale)} TND`}
                      {r.negotiable && !r.price_on_request && (
                        <span className="ms-1.5 text-[10.5px] font-bold text-muted">négociable</span>
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
                        <MapPin className="size-3" /> {r.governorate}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={qs({ page: page - 1 > 1 ? String(page - 1) : undefined }) as never}
              className="tap-target inline-flex items-center gap-1 rounded-full bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/30"
            >
              <ChevronLeft className="size-4" /> Précédent
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
              Suivant <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span aria-hidden className="w-[108px]" />
          )}
        </nav>
      )}
    </main>
  );
}
