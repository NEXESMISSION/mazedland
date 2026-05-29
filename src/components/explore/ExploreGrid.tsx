"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { AuctionWithProperty } from "@/lib/types";
import { propertyPhotoUrl, isStaticSeedPath } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { formatTND } from "@/lib/utils";
import { WatchlistButton } from "@/components/watchlist/WatchlistButton";
import { LiveTimer } from "@/components/landing/LiveTimer";
import { Pagination } from "@/components/ui/Pagination";
import {
  ArrowUpRight,
  Gavel,
  Tag,
  Loader2,
  SlidersHorizontal,
  Search,
  X,
  Clock,
} from "lucide-react";
import type { ExploreFilter } from "./ExploreFeed";
import type { PropertyType } from "@/lib/types";

const PROPERTY_TYPES: { key: PropertyType; label: string }[] = [
  { key: "apartment", label: "Appartement" },
  { key: "villa", label: "Villa" },
  { key: "house", label: "Maison" },
  { key: "land", label: "Terrain" },
  { key: "commercial", label: "Commerce" },
  { key: "office", label: "Bureau" },
  { key: "warehouse", label: "Dépôt" },
  { key: "farm", label: "Ferme" },
];

const GOVERNORATES = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
  "Kairouan", "Béja", "Jendouba", "Kef",
];

export type ExtraFilters = {
  types: PropertyType[];
  gov: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  minRooms: number | null;
};

const EMPTY_FILTERS: ExtraFilters = {
  types: [],
  gov: null,
  minPrice: null,
  maxPrice: null,
  minArea: null,
  minRooms: null,
};

function activeCount(f: ExtraFilters) {
  let n = 0;
  if (f.types.length > 0) n++;
  if (f.gov) n++;
  if (f.minPrice !== null) n++;
  if (f.maxPrice !== null) n++;
  if (f.minArea !== null) n++;
  if (f.minRooms !== null) n++;
  return n;
}

const GRID_PAGE_SIZE = 12;

function buildQuery(
  filter: ExploreFilter,
  extra: ExtraFilters,
  page: number,
  search: string,
) {
  const p = new URLSearchParams();
  p.set("filter", filter);
  p.set("limit", String(GRID_PAGE_SIZE));
  p.set("page", String(page));
  const term = search.trim();
  if (term) p.set("q", term);
  if (extra.types.length > 0) p.set("types", extra.types.join(","));
  if (extra.gov) p.set("gov", extra.gov);
  if (extra.minPrice !== null) p.set("min_price", String(extra.minPrice));
  if (extra.maxPrice !== null) p.set("max_price", String(extra.maxPrice));
  if (extra.minArea !== null) p.set("min_area", String(extra.minArea));
  if (extra.minRooms !== null) p.set("min_rooms", String(extra.minRooms));
  return p.toString();
}

/**
 * Classic 2-up (mobile) / 4-up (desktop) grid view of the same feed
 * served by /api/explore. Mirrors ExploreFeed's filter logic so users
 * can switch view modes without losing context. Each card here is a
 * compact tile (photo + title + price + status pill) — the comfortable
 * scannable layout that existed before the TikTok feed.
 */
export function ExploreGrid({
  initialItems,
  initialFilter,
  initialPage = 1,
  initialTotalPages = 1,
  initialTotalCount,
  loggedIn,
  savedAuctionIds,
  viewToggle,
  initialExtra,
}: {
  initialItems: AuctionWithProperty[];
  initialFilter: ExploreFilter;
  initialPage?: number;
  initialTotalPages?: number;
  initialTotalCount?: number;
  loggedIn: boolean;
  savedAuctionIds: string[];
  /** Slot for the Grid/Reels toggle, rendered in the page-title row. */
  viewToggle?: React.ReactNode;
  initialExtra?: ExtraFilters;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [filter, setFilter] = useState<ExploreFilter>(initialFilter);
  const [extra, setExtra] = useState<ExtraFilters>(initialExtra ?? EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [items, setItems] = useState<AuctionWithProperty[]>(initialItems);
  const [page, setPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [totalCount, setTotalCount] = useState<number>(
    initialTotalCount ?? initialItems.length,
  );
  const [loading, setLoading] = useState(false);
  const savedSet = useMemo(() => new Set(savedAuctionIds), [savedAuctionIds]);
  const requestToken = useRef(0);
  const topAnchorRef = useRef<HTMLDivElement | null>(null);

  // Scroll to the very top of the viewport on first mount. Next.js
  // sometimes restores the scroll position from the prior page
  // (browser back-forward cache, or arriving via in-app SPA nav), and
  // the catalogue index reads as broken when it opens already
  // scrolled past the sticky filter. Smooth so it doesn't feel like
  // a hard jump if the user briefly sees the prior position.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // disable browser scroll restoration for this route so a
    // back-nav from a property detail also lands at the top
    if ("scrollRestoration" in window.history) {
      try {
        window.history.scrollRestoration = "manual";
      } catch {
        /* some embedded webviews block this — ignore */
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loads one page and replaces the visible items. Each user action
  // (filter switch, extra-filter apply, page click) routes through this
  // single fetch path so the loading state, cancellation token, and
  // scroll-to-top behaviour stay consistent.
  const goToPage = useCallback(
    async (
      nextPage: number,
      nextFilter: ExploreFilter = filter,
      nextExtra: ExtraFilters = extra,
      nextSearch: string = search,
    ) => {
      const token = ++requestToken.current;
      setLoading(true);
      try {
        const qs = buildQuery(nextFilter, nextExtra, nextPage, nextSearch);
        const res = await fetch(`/api/explore?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const data = (await res.json()) as {
          items: AuctionWithProperty[];
          page: number;
          totalPages: number;
          totalCount: number;
        };
        if (requestToken.current !== token) return;
        setItems(data.items);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);
        // Scroll all the way to the top of the document, smoothly. The
        // previous version did scrollIntoView() on a mid-page anchor
        // which 1) left the sticky filter band overlapping the new
        // results and 2) animated to ~150px instead of 0, so the page
        // felt like it teleported. Going to absolute 0 with smooth
        // behavior matches the "page change → fresh top" expectation
        // the user flagged.
        window.scrollTo({ top: 0, behavior: "smooth" });
      } finally {
        if (requestToken.current === token) setLoading(false);
      }
    },
    [extra, filter, search],
  );

  // Debounced free-text search. Skips the initial mount so the SSR page
  // isn't immediately refetched; thereafter each keystroke (settled for
  // 350ms) reloads page 1 with the current filters preserved.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const handle = setTimeout(() => {
      void goToPage(1, filter, extra, search);
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const applyFilter = useCallback(
    async (next: ExploreFilter) => {
      if (next === filter) return;
      setFilter(next);
      await goToPage(1, next, extra);
    },
    [extra, filter, goToPage],
  );

  const applyExtraFilters = useCallback(
    async (nextExtra: ExtraFilters) => {
      setExtra(nextExtra);
      setPanelOpen(false);
      await goToPage(1, filter, nextExtra);
    },
    [filter, goToPage],
  );

  const resetExtraFilters = useCallback(async () => {
    if (activeCount(extra) === 0) {
      setPanelOpen(false);
      return;
    }
    setExtra(EMPTY_FILTERS);
    setPanelOpen(false);
    await goToPage(1, filter, EMPTY_FILTERS);
  }, [extra, filter, goToPage]);

  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* Sticky header — filter pills + "Filtres" button only. View
          toggle moved to the page-title row so the filter rail isn't
          fighting the toggle for horizontal real estate on mobile. */}
      <div className="sticky top-[calc(var(--batta-topbar-h)+var(--batta-safe-top))] z-30 bg-background/95 backdrop-blur-md">
        {/* Free-text search — title / ville / adresse. */}
        <div className="px-4 pt-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              strokeWidth={2.2}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par titre, ville, adresse…"
              aria-label="Rechercher une annonce"
              className="h-11 w-full rounded-full border border-border bg-white ps-10 pe-10 text-[13.5px] text-foreground placeholder:text-[var(--foreground-subtle)] transition focus:border-[var(--gold)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-faint)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Effacer la recherche"
                className="absolute end-2.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-4" strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
        <div className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto px-4 pt-2.5 pb-3">
          <GridPill
            active={filter === "all"}
            onClick={() => applyFilter("all")}
            disabled={loading}
            label={t("common.all")}
          />
          <GridPill
            active={filter === "auction"}
            onClick={() => applyFilter("auction")}
            disabled={loading}
            icon={<Gavel className="size-3.5" strokeWidth={2.5} />}
            label="Enchères"
          />
          <GridPill
            active={filter === "direct"}
            onClick={() => applyFilter("direct")}
            disabled={loading}
            icon={<Tag className="size-3.5" strokeWidth={2.5} />}
            label="Offres"
          />
          <FilterButton
            count={activeCount(extra)}
            onClick={() => setPanelOpen((v) => !v)}
            active={panelOpen}
          />
        </div>
        <div aria-hidden className="batta-gold-rule" />
      </div>

      {panelOpen && (
        <FilterPanel
          initial={extra}
          onApply={applyExtraFilters}
          onReset={resetExtraFilters}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <div ref={topAnchorRef} className="px-4 pt-5">
        {/* Page title + view toggle on the right — keeps the filter
            rail clean and gives the toggle a permanent home that won't
            crowd the pills on narrow screens. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="batta-eyebrow">The catalogue</span>
            <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight">
              {t("nav.properties")}
            </h1>
            <p className="batta-tabular mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
              {totalCount > 0 ? (
                <>
                  Page {page} / {totalPages} · {totalCount} annonces
                </>
              ) : (
                "0 annonces"
              )}
            </p>
          </div>
          {viewToggle && <div className="shrink-0 pt-1">{viewToggle}</div>}
        </div>

        {items.length === 0 && !loading ? (
          <GridEmptyState filter={filter} search={search} />
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 pb-6 lg:grid-cols-4 lg:gap-5">
            {items.map((a, i) => (
              <GridCard
                key={a.id}
                auction={a}
                saved={savedSet.has(a.id)}
                loggedIn={loggedIn}
                priority={i < 4}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                t={t as any}
                locale={locale}
              />
            ))}
          </div>
        )}

        {loading && (
          <div className="flex h-16 items-center justify-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {/* Numbered pagination — primary navigation now. Sits below the
            grid; one click per page jump. */}
        {totalPages > 1 && (
          <div className="pb-10 pt-2">
            <Pagination
              page={page}
              totalPages={totalPages}
              disabled={loading}
              onPageChange={(p) => void goToPage(p)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function GridPill({
  active,
  onClick,
  disabled,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
        active
          ? "border-[var(--gold)] bg-[var(--gold)] text-white"
          : "border-[var(--border)] bg-white text-[var(--foreground-muted)] hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────

function GridCard({
  auction,
  saved,
  loggedIn,
  priority,
  t,
  locale,
}: {
  auction: AuctionWithProperty;
  saved: boolean;
  loggedIn: boolean;
  priority: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  locale: string;
}) {
  const property = auction.property;
  const heroPhoto = useMemo(
    () => property.photos?.slice().sort((a, b) => a.sort_order - b.sort_order)[0],
    [property.photos],
  );
  const isDirect = auction.listing_type === "direct";
  const isLive = auction.status === "live" || auction.status === "extending";
  // Scheduled (pre-live with a future starts_at) → show a countdown
  // pill instead of just the type label, so the seller's time range
  // surfaces immediately in the grid.
  const startsAtMs = auction.starts_at ? new Date(auction.starts_at).getTime() : null;
  const isScheduled =
    !isDirect && !isLive && startsAtMs !== null && startsAtMs > Date.now();
  const price = isDirect
    ? (auction.sale_price ?? auction.opening_price)
    : (auction.current_price ?? auction.opening_price);

  return (
    <Link
      href={`/auctions/${auction.id}` as `/auctions/${string}`}
      className="group block"
      aria-label={property.title}
    >
      <div className="relative">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border transition-all duration-300 group-hover:ring-gold-soft/40">
          {heroPhoto ? (
            (() => {
              const src = propertyPhotoUrl(heroPhoto.storage_path);
              const blur = IMAGE_BLUR_MAP[heroPhoto.storage_path];
              const unoptimized = isStaticSeedPath(src);
              return (
                <Image
                  src={src}
                  alt={property.title}
                  fill
                  sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
                  priority={priority}
                  placeholder={blur ? "blur" : "empty"}
                  blurDataURL={blur}
                  unoptimized={unoptimized}
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              );
            })()
          ) : (
            <div className="flex h-full items-center justify-center text-5xl text-foreground/15">
              🏛️
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

          {/* Status pill — top-leading. Direct listings always show the
              gold offer pill so the listing intent is obvious at a glance. */}
          <div className="absolute top-2.5 start-2.5">
            {isDirect ? (
              <span className="batta-gold-fill inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
                <Tag className="size-3" strokeWidth={2.5} />
                Offre
              </span>
            ) : isLive ? (
              <span className="glass inline-flex h-7 items-center gap-1.5 rounded-full px-2.5">
                <span className="batta-pulse-dot size-1.5 rounded-full bg-red-500" />
                <LiveTimer
                  endsAt={auction.ends_at}
                  className="batta-tabular text-[10.5px] font-bold text-foreground"
                />
              </span>
            ) : isScheduled ? (
              <span className="batta-gold-fill inline-flex h-7 items-center gap-1 rounded-full px-2.5 shadow-[var(--shadow-gold)]">
                <Clock className="size-3" strokeWidth={2.5} />
                <LiveTimer
                  endsAt={auction.starts_at as string}
                  className="batta-tabular text-[10.5px] font-bold"
                />
              </span>
            ) : (
              <span className="batta-gold-fill inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
                <Gavel className="size-3" strokeWidth={2.5} />
                {t(`auction.types.${auction.type}`)}
              </span>
            )}
          </div>

          <div className="absolute bottom-2.5 start-2.5">
            <WatchlistButton
              auctionId={auction.id}
              initialSaved={saved}
              loggedIn={loggedIn}
              size="sm"
            />
          </div>

          <div className="absolute bottom-2.5 end-2.5">
            <span className="batta-gradient-gold inline-flex h-9 w-9 items-center justify-center rounded-full text-white ring-1 ring-black/5 shadow-[var(--shadow-gold)] transition-transform group-hover:scale-110 group-hover:rotate-45">
              <ArrowUpRight className="size-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>

        <div className="space-y-1 px-1 pt-3">
          <h3
            dir="auto"
            className="line-clamp-1 text-[15px] font-bold leading-tight"
          >
            {property.title}
            <span className="ms-1 text-[12px] font-medium text-muted">
              · {property.governorate}
            </span>
          </h3>
          <div className="flex items-center justify-between gap-2">
            <span
              dir="ltr"
              className="batta-tabular gradient-gold-text inline-flex items-baseline gap-1 text-base font-extrabold"
            >
              {formatTND(price, locale)}
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                {t("common.tnd")}
              </span>
            </span>
            {isDirect ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                <Tag className="size-3" strokeWidth={2} />
                Prix fixe
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                <Gavel className="size-3" strokeWidth={2} />
                {t(`auction.types.${auction.type}`)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function FilterButton({
  count,
  onClick,
  active,
}: {
  count: number;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label="Filtres avancés"
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
        active || count > 0
          ? "border-[var(--gold)] bg-[var(--gold-faint)] text-[var(--gold)]"
          : "border-[var(--border)] bg-white text-[var(--foreground-muted)] hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
      }`}
    >
      <SlidersHorizontal className="size-3.5" strokeWidth={2.2} />
      Filtres
      {count > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--gold)] px-1 text-[9px] font-extrabold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function FilterPanel({
  initial,
  onApply,
  onReset,
  onClose,
}: {
  initial: ExtraFilters;
  onApply: (next: ExtraFilters) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // Local draft state — the user can pick freely, only `onApply` commits.
  const [draft, setDraft] = useState<ExtraFilters>(initial);

  const toggleType = (key: PropertyType) => {
    setDraft((d) =>
      d.types.includes(key)
        ? { ...d, types: d.types.filter((t) => t !== key) }
        : { ...d, types: [...d.types, key] },
    );
  };

  const setGov = (g: string | null) =>
    setDraft((d) => ({ ...d, gov: g === "" ? null : g }));

  const setNum = (key: keyof ExtraFilters) => (raw: string) => {
    const v = raw.trim();
    setDraft((d) => ({
      ...d,
      [key]: v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)),
    }));
  };

  return (
    <div className="border-b border-border bg-white px-4 py-4 lg:px-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="batta-eyebrow inline-flex items-center gap-2">
          <SlidersHorizontal className="size-3.5" strokeWidth={2.4} />
          Filtres
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer les filtres"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-4" strokeWidth={2.2} />
        </button>
      </div>

      {/* Type chips */}
      <div className="mt-4">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          Type de bien
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROPERTY_TYPES.map((p) => {
            const active = draft.types.includes(p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => toggleType(p.key)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                  active
                    ? "border-[var(--gold)] bg-[var(--gold)] text-white"
                    : "border-[var(--border)] bg-white text-[var(--foreground-muted)] hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Governorate select */}
      <div className="mt-4">
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          Gouvernorat
        </label>
        <select
          value={draft.gov ?? ""}
          onChange={(e) => setGov(e.target.value || null)}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px]"
        >
          <option value="">Tous les gouvernorats</option>
          {GOVERNORATES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* Price range */}
      <div className="mt-4">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          Prix (TND)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min"
            value={draft.minPrice ?? ""}
            onChange={(e) => setNum("minPrice")(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px] tabular-nums"
          />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Max"
            value={draft.maxPrice ?? ""}
            onChange={(e) => setNum("maxPrice")(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px] tabular-nums"
          />
        </div>
      </div>

      {/* Area + rooms */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            Surface min (m²)
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="ex. 80"
            value={draft.minArea ?? ""}
            onChange={(e) => setNum("minArea")(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px] tabular-nums"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            Pièces min
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="ex. 3"
            value={draft.minRooms ?? ""}
            onChange={(e) => setNum("minRooms")(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px] tabular-nums"
          />
        </div>
      </div>

      {/* Apply / Reset */}
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onReset}
          className="flex-1 rounded-full border border-border bg-white px-4 py-2.5 text-[12.5px] font-bold text-muted transition hover:border-[var(--gold-soft)] hover:text-foreground"
        >
          Réinitialiser
        </button>
        <button
          type="button"
          onClick={() => onApply(draft)}
          className="batta-btn-luxe tap-target flex-1 px-4 py-2.5 text-[12.5px]"
        >
          Appliquer
        </button>
      </div>
    </div>
  );
}

function GridEmptyState({
  filter,
  search,
}: {
  filter: ExploreFilter;
  search?: string;
}) {
  const term = search?.trim();
  const label = term
    ? `Aucun résultat pour « ${term} ».`
    : filter === "auction"
      ? "Aucune enchère active pour le moment."
      : filter === "direct"
        ? "Aucune offre directe pour le moment."
        : "Aucune annonce pour le moment.";
  return (
    <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
      <div className="relative">
        <span className="batta-monogram batta-monogram-filled mx-auto mb-4 size-12 text-[20px]">
          ✦
        </span>
        <p className="text-[18px] font-bold text-foreground">{label}</p>
        <p className="mt-2 text-[12px] text-muted">
          Revenez bientôt — de nouvelles annonces arrivent chaque jour.
        </p>
      </div>
    </div>
  );
}
