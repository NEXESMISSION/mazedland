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
  ArrowUp,
  Gavel,
  Tag,
  Share2,
  MapPin,
  Loader2,
} from "lucide-react";

export type ExploreFilter = "all" | "auction" | "direct";

const REELS_PAGE_SIZE = 8;

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
  // Tracks whether the user has scrolled past the first card. Drives
  // visibility of the floating "back to top" button — hidden when at
  // the top so it doesn't sit on top of the first card uselessly.
  const [scrolled, setScrolled] = useState(false);
  // Initial heart state per auction id, pre-resolved on the server so
  // the user's saved listings show up filled on first paint.
  const savedSet = useMemo(() => new Set(savedAuctionIds), [savedAuctionIds]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Token bumps on every fetch so a stale in-flight response can't race
  // a fresh one and overwrite the new feed.
  const requestToken = useRef(0);

  // Snap-y scroll listener — flips `scrolled` once the user is past
  // ~half the first card. Reset on every page change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      const top = el!.scrollTop;
      setScrolled(top > 80);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [items.length]);

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const goToPage = useCallback(
    async (nextPage: number, nextFilter: ExploreFilter = filter) => {
      const token = ++requestToken.current;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/explore?filter=${nextFilter}&limit=${REELS_PAGE_SIZE}&page=${nextPage}`,
          { cache: "no-store" },
        );
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
        containerRef.current?.scrollTo({ top: 0 });
        setScrolled(false);
      } finally {
        if (requestToken.current === token) setLoading(false);
      }
    },
    [filter],
  );

  const applyFilter = useCallback(
    async (next: ExploreFilter) => {
      if (next === filter) return;
      setFilter(next);
      await goToPage(1, next);
    },
    [filter, goToPage],
  );

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

      {/* Back-to-top — appears after the first card so swiping up to
          retrace your steps is just a tap away. Sits bottom-right above
          the global FAB / bottom tab bar. */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Retour en haut"
        className={`absolute right-4 bottom-6 z-40 inline-flex size-11 items-center justify-center rounded-full border border-[var(--border)] bg-white text-foreground shadow-[var(--shadow-md)] transition-all duration-300 active:scale-90 ${
          scrolled
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <ArrowUp className="size-5" strokeWidth={2.4} />
      </button>
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
    <article className="relative h-full w-full snap-start snap-always overflow-hidden bg-[var(--background)]">
      {/* PHOTO — top 52% of viewport. Status pill is anchored to the
          bottom edge of the photo so the card body underneath can lead
          with the title (the user's first reading move). */}
      <div className="absolute inset-x-0 top-0 h-[52%] overflow-hidden bg-[var(--surface-2)]">
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
          <div className="flex h-full items-center justify-center text-7xl text-foreground/15">
            🏛️
          </div>
        )}

        {/* Light scrim under the filter rail so the white pills stay
            readable on bright photos. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/25 to-transparent" />
        {/* Bottom scrim — keeps the status pill anchored over the photo
            readable on any background. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" />

        {/* Lot tag — top-leading. A subtle "LOT · A2F4" mono badge
            that gives each card a numbered-consignment feel. */}
        <div className="absolute left-4 top-16 z-10">
          <span className="batta-tabular inline-flex h-6 items-center gap-1 rounded-full border border-white/25 bg-black/40 px-2.5 font-mono text-[9.5px] font-bold tracking-[0.14em] text-white backdrop-blur-md">
            LOT · {lotNo}
          </span>
        </div>

        {/* Status pill — anchored to the BOTTOM-LEADING of the photo,
            half-overlapping the seam between photo and card. Hot signal
            sits exactly where the eye lands when scanning a new card. */}
        <div className="absolute -bottom-3 left-4 z-20">
          {isDirect ? (
            <span className="batta-gradient-gold inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[var(--shadow-gold)] ring-2 ring-white">
              <Tag className="size-3.5" strokeWidth={2.5} />
              Offre directe
            </span>
          ) : isLive ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red-500 px-3 text-white shadow-[0_4px_16px_-4px_rgba(239,68,68,0.6)] ring-2 ring-white">
              <span className="batta-pulse-dot size-1.5 rounded-full bg-white" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em]">
                En direct
              </span>
              <span aria-hidden className="text-white/50">·</span>
              <LiveTimer
                endsAt={auction.ends_at}
                className="batta-tabular text-[10.5px] font-bold"
              />
            </span>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[var(--shadow-md)] ring-2 ring-white">
              <Gavel className="size-3.5" strokeWidth={2.5} />
              {t(`auction.types.${auction.type}`)}
            </span>
          )}
        </div>
      </div>

      {/* Right action rail — heart + share float over the photo as
          glass discs. Positioned over photo only; never near the card
          content. */}
      <div className="absolute right-4 top-[26%] z-20 flex flex-col items-center gap-3">
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
          className="inline-flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition active:scale-90 hover:bg-black/60"
        >
          <Share2 className="size-5" strokeWidth={2.2} />
        </button>
      </div>

      {/* INFO CARD — white, rounded top corners, ~48% of viewport.
          Layout flows: title → spec chips → divider → price + CTA. */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-[28px] bg-[var(--background)] px-5 pb-6 pt-7"
        style={{
          top: "49%",
          boxShadow: "0 -18px 40px -16px rgba(15,23,42,0.16)",
        }}
      >
        {/* Title leads — first thing the eye lands on when card snaps in */}
        <h2
          dir="auto"
          className="line-clamp-2 text-[22px] font-extrabold leading-[1.2] tracking-tight text-foreground"
        >
          {property.title}
        </h2>

        {/* Spec chips — small bordered pills with subtle gold tint, more
            premium than plain "·" separators. Each spec is its own tap-
            sized chip so the eye can scan them in any order. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <SpecChip
            icon={<MapPin className="size-3.5" strokeWidth={2} />}
            label={property.governorate}
          />
          <SpecChip
            label={t(`property.types.${property.type}`)}
            uppercase
          />
          {property.area_sqm ? (
            <SpecChip label={`${property.area_sqm} m²`} mono />
          ) : null}
          {property.rooms ? (
            <SpecChip label={`${property.rooms} pièces`} />
          ) : null}
        </div>

        {/* Hairline divider — separates specs from the price-decision
            block. Gold tint matches the brand palette. */}
        <div
          aria-hidden
          className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-[var(--gold-soft)]/30 to-transparent"
        />

        {/* Price + CTA — the decision block. Price gets eyebrow + big
            gold-gradient number; "négociable" chip drops in below if
            the seller flagged the offer as open to talk. */}
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
              {priceLabel}
            </div>
            <div
              dir="ltr"
              className="batta-tabular mt-1 inline-flex items-baseline gap-1.5"
            >
              <span className="gradient-gold-text text-[30px] font-extrabold leading-none">
                {formatTND(price, locale)}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                {t("common.tnd")}
              </span>
            </div>
            {isDirect && auction.sale_negotiable && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-200">
                Négociable
              </span>
            )}
          </div>
        </div>

        {/* Primary CTA — full-width gold pill. Sits at the very bottom
            of the card so the thumb has the same target on every card. */}
        <Link
          href={`/auctions/${auction.id}` as `/auctions/${string}`}
          className="batta-gradient-gold tap-target mt-auto flex w-full items-center justify-center gap-1.5 rounded-full px-5 py-3.5 text-[13.5px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[var(--shadow-gold)] ring-1 ring-black/5 transition active:scale-[0.98]"
        >
          {isDirect ? "Voir l'offre" : "Enchérir maintenant"}
          <ArrowUpRight className="size-4" strokeWidth={2.5} />
        </Link>
      </div>
    </article>
  );
}

function SpecChip({
  icon,
  label,
  uppercase = false,
  mono = false,
}: {
  icon?: React.ReactNode;
  label: string;
  uppercase?: boolean;
  mono?: boolean;
}) {
  return (
    <span
      className={
        "inline-flex h-7 items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2.5 text-[11.5px] font-semibold text-foreground " +
        (uppercase ? "uppercase tracking-[0.12em] text-[11px] " : "") +
        (mono ? "batta-tabular " : "")
      }
    >
      {icon && <span className="text-[var(--gold)]">{icon}</span>}
      {label}
    </span>
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
