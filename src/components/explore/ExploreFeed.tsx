"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Share2,
  MapPin,
  Loader2,
} from "lucide-react";

export type ExploreFilter = "all" | "auction" | "direct";

const REELS_PAGE_SIZE = 8;
// How long a cached page stays fresh. Live auctions update their
// `current_price` and countdown in real time; 45s is long enough to
// make back-navigation feel instant but short enough that a returning
// user never sees a stale price for more than a swipe.
const PAGE_CACHE_TTL_MS = 45_000;

type PageData = {
  items: AuctionWithProperty[];
  page: number;
  totalPages: number;
  totalCount: number;
};

type CacheEntry = { data: PageData; cachedAt: number };

/**
 * Reels-style vertical feed with numbered pagination.
 *
 *   - Photo on top ~58%, white info card below — same layout language
 *     as the rest of the app (no more dark island).
 *   - CSS scroll-snap-y mandatory: every swipe lands cleanly on the
 *     next listing within the current page.
 *   - Top: filter pills (Tous / Enchères / Offres) + view toggle.
 *   - Bottom: numbered pagination [<] [1] [2] [3] [>] — pages are
 *     loaded one at a time from /api/explore, never all at once.
 */
export function ExploreFeed({
  initialItems,
  initialFilter,
  initialPage = 1,
  initialTotalPages = 1,
  initialTotalCount,
  loggedIn,
  savedAuctionIds,
  viewToggle,
}: {
  initialItems: AuctionWithProperty[];
  initialFilter: ExploreFilter;
  initialPage?: number;
  initialTotalPages?: number;
  initialTotalCount?: number;
  loggedIn: boolean;
  savedAuctionIds: string[];
  /** Optional slot for the Grid/Reels toggle, shown in the filter rail. */
  viewToggle?: React.ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [filter, setFilter] = useState<ExploreFilter>(initialFilter);
  const [items, setItems] = useState<AuctionWithProperty[]>(initialItems);
  const [page, setPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [totalCount, setTotalCount] = useState<number>(
    initialTotalCount ?? initialItems.length,
  );
  const [loading, setLoading] = useState(false);
  // Initial heart state per auction id, pre-resolved on the server so
  // the user's saved listings show up filled on first paint.
  const savedSet = useMemo(() => new Set(savedAuctionIds), [savedAuctionIds]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Token bumps on every fetch so a stale in-flight response can't race
  // a fresh one and overwrite the new feed.
  const requestToken = useRef(0);

  // ─── Data optimisation layer ──────────────────────────────────────
  //
  // pageCache — in-memory store keyed by `${filter}:${page}`. Pages
  //   stay fresh for PAGE_CACHE_TTL_MS so back-navigation (swipe
  //   page 3 → page 2) is instant instead of re-hitting the network.
  //
  // inflight — map of currently-running fetches by the same key. If
  //   the user fires the same request twice (e.g. two quick filter
  //   pill clicks), we await the original promise instead of opening
  //   a second TCP connection.
  //
  // Both live in refs so they don't trigger re-renders and survive
  // across React's StrictMode double-invocation in dev.
  const pageCache = useRef(new Map<string, CacheEntry>());
  const inflight = useRef(new Map<string, Promise<PageData>>());

  // Seed the cache with the server-side initial slice so the very
  // first navigation away-and-back doesn't refetch what we already
  // painted. Runs once per (initialFilter, initialPage) pair.
  useEffect(() => {
    const key = `${initialFilter}:${initialPage}`;
    pageCache.current.set(key, {
      data: {
        items: initialItems,
        page: initialPage,
        totalPages: initialTotalPages,
        totalCount: initialTotalCount ?? initialItems.length,
      },
      cachedAt: Date.now(),
    });
    // Intentionally only seeds once on mount — subsequent fetches
    // refresh the cache themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPage = useCallback(
    async (
      pageNum: number,
      filterVal: ExploreFilter,
      opts: { force?: boolean } = {},
    ): Promise<PageData> => {
      const key = `${filterVal}:${pageNum}`;

      // 1. Cache hit (fresh) — return synchronously.
      if (!opts.force) {
        const cached = pageCache.current.get(key);
        if (cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) {
          return cached.data;
        }
      }

      // 2. Same request already in flight — piggyback on it.
      const existing = inflight.current.get(key);
      if (existing) return existing;

      // 3. Network round-trip.
      const promise = (async () => {
        const res = await fetch(
          `/api/explore?filter=${filterVal}&limit=${REELS_PAGE_SIZE}&page=${pageNum}`,
        );
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const data = (await res.json()) as PageData;
        pageCache.current.set(key, { data, cachedAt: Date.now() });
        return data;
      })();
      inflight.current.set(key, promise);
      try {
        return await promise;
      } finally {
        inflight.current.delete(key);
      }
    },
    [],
  );

  const goToPage = useCallback(
    async (nextPage: number, nextFilter: ExploreFilter = filter) => {
      const token = ++requestToken.current;
      const key = `${nextFilter}:${nextPage}`;
      // Show the loading shim only when the page isn't already in
      // cache — if we have it warm, we paint instantly and skip the
      // spinner flash entirely.
      const cached = pageCache.current.get(key);
      const fromCache =
        cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS;
      if (!fromCache) setLoading(true);

      try {
        const data = await fetchPage(nextPage, nextFilter);
        if (requestToken.current !== token) return; // superseded
        setItems(data.items);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);
        containerRef.current?.scrollTo({ top: 0 });
      } finally {
        if (requestToken.current === token) setLoading(false);
      }
    },
    [fetchPage, filter],
  );

  const applyFilter = useCallback(
    async (next: ExploreFilter) => {
      if (next === filter) return;
      // Drop cached pages for the OLD filter — they're stale to the
      // user's new intent and would just eat memory. Also clear any
      // still-running fetches so they don't overwrite the new feed.
      pageCache.current.clear();
      inflight.current.clear();
      setFilter(next);
      await goToPage(1, next);
    },
    [filter, goToPage],
  );

  // Prefetch the NEXT page in the background once the current page
  // paints, so swiping into "Page X" → picking page X+1 feels
  // instant. Uses requestIdleCallback when available (browser tells
  // us when it's truly idle); falls back to a setTimeout. Fire-and-
  // forget — errors are swallowed because this is purely speculative.
  useEffect(() => {
    if (loading) return;
    if (page >= totalPages) return;
    const key = `${filter}:${page + 1}`;
    const cached = pageCache.current.get(key);
    if (cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) return;

    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const run = () => {
      void fetchPage(page + 1, filter).catch(() => {});
    };
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 1500 });
    } else {
      timeoutHandle = window.setTimeout(run, 400);
    }
    return () => {
      if (idleHandle !== null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [fetchPage, filter, loading, page, totalPages]);

  return (
    <div className="relative h-[calc(100dvh-var(--batta-topbar-h)-var(--batta-safe-top)-var(--batta-bottombar-total))] w-full overflow-hidden bg-[var(--background)]">
      {/* Filter rail — sticky over the feed at the top */}
      <FilterRail
        filter={filter}
        onSelect={applyFilter}
        disabled={loading}
        t={t}
        viewToggle={viewToggle}
      />

      {/* Snap-scroll feed */}
      <div
        ref={containerRef}
        className="hide-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain"
        style={{ scrollSnapStop: "always" }}
      >
        {items.length === 0 && !loading ? (
          <EmptyState filter={filter} />
        ) : (
          items.map((a, i) => (
            <FeedCard
              key={a.id}
              auction={a}
              priority={i < 2}
              loggedIn={loggedIn}
              saved={savedSet.has(a.id)}
              t={t}
              locale={locale}
            />
          ))
        )}

        {loading && (
          <div className="flex h-32 snap-start items-center justify-center text-[var(--foreground-muted)]">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {/* Pagination "page" — sits in the snap stream so a swipe-up
            after the last card lands on it cleanly. The user picks the
            next page from here. */}
        {!loading && totalPages > 1 && items.length > 0 && (
          <div className="flex h-full min-h-[60vh] snap-start flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
              Page {page} sur {totalPages}
            </div>
            <p className="text-[14px] font-semibold text-foreground">
              {totalCount} annonces au total
            </p>
            <p className="max-w-[260px] text-[12px] text-[var(--foreground-muted)]">
              Choisissez une page ci-dessous pour continuer.
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              disabled={loading}
              onPageChange={(p) => void goToPage(p)}
              className="mt-2"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Filter rail ──────────────────────────────────────────────────────

function FilterRail({
  filter,
  onSelect,
  disabled,
  t,
  viewToggle,
}: {
  filter: ExploreFilter;
  onSelect: (next: ExploreFilter) => void;
  disabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  viewToggle?: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-2 px-3 pt-3">
      <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white/95 p-1 shadow-sm backdrop-blur-xl">
        <Pill
          active={filter === "all"}
          onClick={() => onSelect("all")}
          disabled={disabled}
          label={t("common.all")}
        />
        <Pill
          active={filter === "auction"}
          onClick={() => onSelect("auction")}
          disabled={disabled}
          icon={<Gavel className="size-3.5" strokeWidth={2.5} />}
          label="Enchères"
        />
        <Pill
          active={filter === "direct"}
          onClick={() => onSelect("direct")}
          disabled={disabled}
          icon={<Tag className="size-3.5" strokeWidth={2.5} />}
          label="Offres"
        />
      </div>
      {viewToggle && (
        <div className="pointer-events-auto">{viewToggle}</div>
      )}
    </div>
  );
}

function Pill({
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
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-bold transition-all disabled:opacity-50 ${
        active
          ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
          : "text-[var(--foreground-muted)] hover:bg-[var(--gold-faint)] hover:text-[var(--gold)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Feed card ────────────────────────────────────────────────────────

function FeedCard({
  auction,
  priority,
  loggedIn,
  saved,
  t,
  locale,
}: {
  auction: AuctionWithProperty;
  priority: boolean;
  loggedIn: boolean;
  saved: boolean;
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
  const price = isDirect
    ? (auction.sale_price ?? auction.opening_price)
    : (auction.current_price ?? auction.opening_price);

  const onShare = async () => {
    const shareUrl = `${window.location.origin}/${locale}/auctions/${auction.id}`;
    const data = { title: property.title, url: shareUrl };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      /* user cancelled — nothing to do */
    }
  };

  // Lot number — last 4 of the auction id, uppercased. Same identity
  // affordance the catalogue grid uses; makes each card feel like a
  // numbered consignment piece rather than an anonymous listing.
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();
  const priceLabel = isDirect
    ? "Prix fixe"
    : isLive
      ? "Enchère actuelle"
      : "Mise à prix";

  return (
    <article className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {/* PHOTO — full-bleed, fills the entire card. TikTok-style:
          the photo is the canvas; everything else floats on top. */}
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
              sizes="100vw"
              priority={priority}
              placeholder={blur ? "blur" : "empty"}
              blurDataURL={blur}
              unoptimized={unoptimized}
              className="object-cover"
            />
          );
        })()
      ) : (
        <div className="flex h-full items-center justify-center text-7xl text-white/15">
          🏛️
        </div>
      )}

      {/* Top scrim — fades the photo into the filter-rail area so the
          white pills overhead stay readable on bright photos. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/30 to-transparent" />
      {/* Bottom scrim — gives the floating info card a soft landing
          when the photo behind it is busy/light-toned. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-black/45 via-black/15 to-transparent" />

      {/* TOP BADGES on the photo — status pill (leading) + LOT tag
          (trailing). Smaller h-6 chips, denser text — every saved px
          here = more photo visible. */}
      <div className="absolute inset-x-3 top-[60px] z-20 flex items-start justify-between gap-2">
        {isDirect ? (
          <span className="batta-gradient-gold inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[var(--shadow-gold)]">
            <Tag className="size-3" strokeWidth={2.5} />
            Offre directe
          </span>
        ) : isLive ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-red-500 px-2.5 text-white shadow-[0_4px_16px_-4px_rgba(239,68,68,0.55)]">
            <span className="batta-pulse-dot size-1.5 rounded-full bg-white" />
            <span className="text-[9.5px] font-extrabold uppercase tracking-[0.12em]">
              En direct
            </span>
            <span aria-hidden className="text-white/50">·</span>
            <LiveTimer
              endsAt={auction.ends_at}
              className="batta-tabular text-[10px] font-bold"
            />
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/20 bg-black/50 px-2.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-white backdrop-blur-md">
            <Gavel className="size-3" strokeWidth={2.5} />
            {t(`auction.types.${auction.type}`)}
          </span>
        )}

        <span className="batta-tabular inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full border border-white/20 bg-black/40 px-2 font-mono text-[9px] font-bold tracking-[0.12em] text-white backdrop-blur-md">
          LOT · {lotNo}
        </span>
      </div>

      {/* RIGHT ACTION RAIL — vertical glass icon column. Anchored to
          sit just above the info card with consistent breathing room. */}
      <div className="absolute right-3 bottom-[28%] z-20 flex flex-col items-center gap-2.5">
        <WatchlistButton
          auctionId={auction.id}
          initialSaved={saved}
          loggedIn={loggedIn}
          size="md"
        />
        <button
          type="button"
          onClick={onShare}
          aria-label="Partager"
          className="inline-flex size-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition active:scale-90 hover:bg-black/60"
        >
          <Share2 className="size-[18px]" strokeWidth={2.2} />
        </button>
      </div>

      {/* FLOATING INFO CARD — compact 2-row layout to maximise photo
          surface area. Row 1: title + meta line. Row 2: price + CTA.
          Padding tightened from p-4 → p-2.5; margins bleed wider. */}
      <div
        className="absolute inset-x-2.5 z-10 rounded-2xl border border-white/60 bg-white/96 px-3.5 py-3 shadow-[0_18px_44px_-18px_rgba(15,23,42,0.45)] backdrop-blur-xl"
        style={{ bottom: "10px" }}
      >
        {/* Title — single line, big enough to read */}
        <h2
          dir="auto"
          className="line-clamp-1 text-[15.5px] font-extrabold leading-tight tracking-tight text-foreground"
        >
          {property.title}
        </h2>

        {/* Meta — inline dot-separated row instead of chip stack.
            Saves a whole row of vertical space vs. the chip layout. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] font-semibold text-[var(--foreground-muted)]">
          <span className="inline-flex items-center gap-1">
            <MapPin
              className="size-3 text-[var(--gold)]"
              strokeWidth={2.2}
            />
            {property.governorate}
          </span>
          <span aria-hidden className="opacity-40">·</span>
          <span className="uppercase tracking-[0.1em]">
            {t(`property.types.${property.type}`)}
          </span>
          {property.area_sqm ? (
            <>
              <span aria-hidden className="opacity-40">·</span>
              <span className="batta-tabular">{property.area_sqm} m²</span>
            </>
          ) : null}
          {property.rooms ? (
            <>
              <span aria-hidden className="opacity-40">·</span>
              <span className="batta-tabular">{property.rooms} p.</span>
            </>
          ) : null}
        </div>

        {/* Price + CTA — same row, vertical-center aligned. Compact. */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[8.5px] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
              {priceLabel}
            </div>
            <div
              dir="ltr"
              className="batta-tabular mt-0.5 inline-flex items-baseline gap-1"
            >
              <span className="gradient-gold-text text-[22px] font-extrabold leading-none">
                {formatTND(price, locale)}
              </span>
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                {t("common.tnd")}
              </span>
              {isDirect && auction.sale_negotiable && (
                <span className="ms-1 inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200">
                  Négo.
                </span>
              )}
            </div>
          </div>

          <Link
            href={`/auctions/${auction.id}` as `/auctions/${string}`}
            className="batta-gradient-gold tap-target inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-3.5 py-2.5 text-[11.5px] font-extrabold uppercase tracking-[0.1em] text-white shadow-[var(--shadow-gold)] ring-1 ring-black/5 transition active:scale-[0.98]"
          >
            {isDirect ? "Voir" : "Enchérir"}
            <ArrowUpRight className="size-3.5" strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </article>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: ExploreFilter }) {
  const label =
    filter === "auction"
      ? "Aucune enchère active pour le moment."
      : filter === "direct"
        ? "Aucune offre directe pour le moment."
        : "Aucune annonce pour le moment.";
  return (
    <div className="flex h-full snap-start flex-col items-center justify-center px-8 text-center">
      <span className="text-5xl">🏛️</span>
      <p className="mt-4 text-[16px] font-bold text-foreground">{label}</p>
      <p className="mt-1 text-[12px] text-[var(--foreground-muted)]">
        Revenez bientôt — de nouvelles annonces arrivent chaque jour.
      </p>
    </div>
  );
}
