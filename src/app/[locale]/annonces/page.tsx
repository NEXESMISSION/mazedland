import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { coverPhoto } from "@/lib/listingCover";
import { ListingImage } from "@/components/media/ListingImage";
import { formatTND } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Home, ImageOff, MapPin, Ruler, SearchX, X } from "lucide-react";

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
  if (m2) out.push(`${m2.toLocaleString("fr-FR")} m²`);
  if (Number(a.rooms) > 0) out.push(`${a.rooms} pièces`);
  if (Number(a.bathrooms) > 0) out.push(`${a.bathrooms} SdB`);
  return out;
}

export default async function AnnoncesPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string; gov?: string; sort?: string; q?: string;
    min?: string; max?: string; page?: string;
    /** Pre-rename price params — see `min` below. */
    min_price?: string; max_price?: string;
  }>;
}) {
  const sp = await searchParams;
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
  if (sp.q?.trim()) q = q.ilike("search_text", `%${sp.q.trim().toLowerCase()}%`);
  if (min) q = q.gte("price", min);
  if (max) q = q.lte("price", max);

  if (sort === "cheap") q = q.order("price", { ascending: true, nullsFirst: false });
  else if (sort === "dear") q = q.order("price", { ascending: false, nullsFirst: false });
  else q = q.order("published_at", { ascending: false });

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
    const { data, count } = await q.range(from, from + PAGE_SIZE - 1);
    rows = (data ?? []) as unknown as Row[];
    total = count ?? rows.length;
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
                    <h2 className="mt-0.5 line-clamp-2 break-words text-[13.5px] font-bold leading-snug text-foreground">
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

                    {specs.length > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
                        <Ruler className="size-3" /> {specs.join(" · ")}
                      </p>
                    )}
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                      <MapPin className="size-3" /> {r.governorate}
                    </p>
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
