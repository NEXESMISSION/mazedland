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
import {
  ArrowUpRight,
  Gavel,
  Tag,
  Share2,
  MapPin,
  RotateCcw,
  Loader2,
  Clock,
} from "lucide-react";

// Kept for callers that still import the type (grid/page share it).
export type ExploreFilter = "all" | "auction" | "direct";

const FEED_LIMIT = 120;
const SEEN_KEY = "batta_seen_reels";
const SEEN_CAP = 1000;

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(set: Set<string>) {
  try {
    // Keep only the most-recent ids so the store can't grow without bound.
    const arr = Array.from(set).slice(-SEEN_CAP);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    /* localStorage blocked — seen-tracking just degrades to per-session */
  }
}

/**
 * Smart shuffle: random order, but live listings (and especially ones
 * ending soon) get nudged toward the top so the feed always opens on
 * something happening now. Lower key = earlier.
 */
function shuffleSmart(list: AuctionWithProperty[]): AuctionWithProperty[] {
  const now = Date.now();
  return list
    .map((a) => {
      const isLive = a.status === "live" || a.status === "extending";
      let key = Math.random();
      if (isLive) {
        key -= 0.25;
        const hoursLeft = (new Date(a.ends_at).getTime() - now) / 3_600_000;
        if (hoursLeft > 0 && hoursLeft < 6) key -= 0.25;
      }
      return { a, key };
    })
    .sort((x, y) => x.key - y.key)
    .map((x) => x.a);
}

/**
 * Reels — a full-screen, TikTok-style vertical feed.
 *
 *   - No filters, no pagination, no white cards. The photo is the canvas;
 *     title / price / actions float on top over a gradient scrim.
 *   - Random order, weighted so live auctions surface first.
 *   - Already-seen listings (tracked in localStorage) are dropped on every
 *     open, so you never scroll past the same property twice. The end card
 *     lets you reset and watch them all again.
 */
export function ExploreFeed({
  initialItems,
  loggedIn,
  savedAuctionIds,
  viewToggle,
}: {
  initialItems: AuctionWithProperty[];
  loggedIn: boolean;
  savedAuctionIds: string[];
  /** Optional Grid/Reels switch, rendered as a floating glass control. */
  viewToggle?: React.ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [items, setItems] = useState<AuctionWithProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(savedAuctionIds));

  const seenRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (opts: { reset?: boolean } = {}) => {
    setLoading(true);
    if (opts.reset) {
      seenRef.current = new Set();
      writeSeen(seenRef.current);
    }
    try {
      const res = await fetch(`/api/explore/feed?limit=${FEED_LIMIT}`);
      const data = res.ok
        ? ((await res.json()) as {
            items: AuctionWithProperty[];
            savedAuctionIds?: string[];
          })
        : { items: [], savedAuctionIds: [] };
      if (data.savedAuctionIds) setSaved(new Set(data.savedAuctionIds));
      const unseen = (data.items ?? []).filter((a) => !seenRef.current.has(a.id));
      setItems(shuffleSmart(unseen));
      containerRef.current?.scrollTo({ top: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  // First paint: show the server slice (minus already-seen) instantly, then
  // refresh from the full feed in the background.
  useEffect(() => {
    seenRef.current = readSeen();
    const initialUnseen = initialItems.filter((a) => !seenRef.current.has(a.id));
    if (initialUnseen.length > 0) {
      setItems(shuffleSmart(initialUnseen));
      setLoading(false);
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark a card seen once it's centered in the viewport. Recorded for next
  // session — we never yank the current card out from under the user.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const id = (e.target as HTMLElement).dataset.id;
            if (id && !seenRef.current.has(id)) {
              seenRef.current.add(id);
              changed = true;
            }
          }
        }
        if (changed) writeSeen(seenRef.current);
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-reel-card]").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items]);

  return (
    <div className="relative h-[calc(100dvh-var(--batta-topbar-h)-var(--batta-safe-top)-var(--batta-bottombar-total))] w-full overflow-hidden bg-black">
      {/* Single floating glass toggle (top-trailing) — the only chrome. */}
      {viewToggle && (
        <div className="pointer-events-auto absolute end-3 top-3 z-30">
          {viewToggle}
        </div>
      )}

      <div
        ref={containerRef}
        data-prevent-pull-to-refresh
        className="hide-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain"
        style={{ scrollSnapStop: "always", touchAction: "pan-y" }}
      >
        {items.length === 0 && !loading ? (
          <EndState empty onReset={() => void load({ reset: true })} />
        ) : (
          <>
            {items.map((a, i) => (
              <FeedCard
                key={a.id}
                auction={a}
                priority={i < 2}
                loggedIn={loggedIn}
                saved={saved.has(a.id)}
                t={t}
                locale={locale}
              />
            ))}
            {!loading && (
              <EndState onReset={() => void load({ reset: true })} />
            )}
          </>
        )}

        {loading && items.length === 0 && (
          <div className="flex h-full items-center justify-center text-white/70">
            <Loader2 className="size-7 animate-spin" />
          </div>
        )}
      </div>
    </div>
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
  // Pre-live but scheduled: the seller already set a time range, so the
  // card should show a "Démarre dans …" countdown instead of just the
  // generic type pill. Anything with a future `starts_at` qualifies —
  // the explicit `scheduled` status is the common case, but a row that
  // hasn't been flipped yet still has a future start time.
  const startsAtMs = auction.starts_at ? new Date(auction.starts_at).getTime() : null;
  const isScheduled =
    !isDirect && !isLive && startsAtMs !== null && startsAtMs > Date.now();
  const price = isDirect
    ? (auction.sale_price ?? auction.opening_price)
    : (auction.current_price ?? auction.opening_price);

  const onShare = async () => {
    const shareUrl = `${window.location.origin}/${locale}/auctions/${auction.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: property.title, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      /* user cancelled */
    }
  };

  const priceLabel = isDirect
    ? "Prix fixe"
    : isLive
      ? "Enchère actuelle"
      : "Mise à prix";

  return (
    <article
      data-reel-card
      data-id={auction.id}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
    >
      {/* PHOTO — full-bleed canvas */}
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

      {/* Scrims — light at the top (status pill), heavy at the bottom so
          the floating text reads on any photo. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%] bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

      {/* Status pill — solo on the top-leading edge. The LOT tag used
          to sit on the top-trailing side, but that's where the
          grid/reels view toggle lives, so the two were stacking on
          phones (visible in the audit screenshot). LOT now lives at
          the bottom-right of the photo where it doesn't compete. */}
      <div className="absolute start-4 top-[60px] z-20 flex items-start">
        {isDirect ? (
          <span className="batta-gradient-gold inline-flex h-7 items-center gap-1 rounded-full px-3 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[var(--shadow-gold)]">
            <Tag className="size-3" strokeWidth={2.5} />
            Offre directe
          </span>
        ) : isLive ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-red-500 px-3 text-white shadow-[0_4px_16px_-4px_rgba(239,68,68,0.6)]">
            <span className="batta-pulse-dot size-1.5 rounded-full bg-white" />
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em]">
              En direct
            </span>
            <span aria-hidden className="text-white/50">·</span>
            <LiveTimer
              endsAt={auction.ends_at}
              className="batta-tabular text-[11px] font-bold"
            />
          </span>
        ) : isScheduled ? (
          <span className="batta-gradient-gold inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-white shadow-[var(--shadow-gold)]">
            <Clock className="size-3" strokeWidth={2.5} />
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em]">
              Démarre dans
            </span>
            <LiveTimer
              endsAt={auction.starts_at as string}
              className="batta-tabular text-[11px] font-bold"
            />
          </span>
        ) : (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-3 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white backdrop-blur-md">
            <Gavel className="size-3" strokeWidth={2.5} />
            {t(`auction.types.${auction.type}`)}
          </span>
        )}
      </div>

      {/* Right action rail — glass icons, sitting above the bottom
          text overlay. Position lifted from bottom-36 → bottom-44 so
          the share button no longer hugs the title line on phones
          with narrower aspect ratios. */}
      <div className="absolute end-3 bottom-44 z-20 flex flex-col items-center gap-3">
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
          className="inline-flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition active:scale-90 hover:bg-black/65"
        >
          <Share2 className="size-[19px]" strokeWidth={2.2} />
        </button>
      </div>

      {/* Floating text — straight on the photo, no card */}
      <div className="absolute inset-x-4 bottom-6 z-10 pe-16">
        <h2
          dir="auto"
          className="line-clamp-2 text-[21px] font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]"
        >
          {property.title}
        </h2>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold text-white/85 drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" strokeWidth={2.4} />
            {property.governorate}
          </span>
          <span aria-hidden className="opacity-40">·</span>
          <span className="uppercase tracking-[0.08em]">
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
          {/* LOT moved here from the top-right of the photo: it's a
              reference number, not a primary call-out, so it reads
              better folded into the meta row alongside governorate +
              type. Frees the top-trailing corner for the view toggle. */}
          <span aria-hidden className="opacity-40">·</span>
          <span className="batta-tabular font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/65">
            Lot {String(auction.id).replace(/-/g, "").slice(-4).toUpperCase()}
          </span>
        </div>

        <div className="mt-3.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-white/65">
              {priceLabel}
            </div>
            <div
              dir="ltr"
              className="batta-tabular mt-0.5 inline-flex items-baseline gap-1.5"
            >
              <span className="text-[30px] font-black leading-none text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                {formatTND(price, locale)}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                {t("common.tnd")}
              </span>
              {isDirect && auction.sale_negotiable && (
                <span className="ms-1 inline-flex items-center rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-white">
                  Négo.
                </span>
              )}
            </div>
          </div>

          <Link
            href={`/auctions/${auction.id}` as `/auctions/${string}`}
            className="batta-gradient-gold tap-target inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-5 py-3 text-[12.5px] font-extrabold uppercase tracking-[0.1em] text-white shadow-[var(--shadow-gold)] ring-1 ring-white/10 transition active:scale-[0.97]"
          >
            {isDirect ? "Voir" : "Enchérir"}
            <ArrowUpRight className="size-4" strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </article>
  );
}

// ─── End / empty state ────────────────────────────────────────────────

function EndState({
  onReset,
  empty,
}: {
  onReset: () => void;
  empty?: boolean;
}) {
  return (
    <div className="flex h-full snap-start flex-col items-center justify-center gap-4 px-8 text-center text-white">
      <span className="text-5xl">{empty ? "🏛️" : "✨"}</span>
      <p className="text-[17px] font-bold">
        {empty ? "Aucune annonce pour le moment." : "Vous avez tout vu."}
      </p>
      <p className="max-w-[260px] text-[13px] text-white/65">
        {empty
          ? "Revenez bientôt — de nouvelles annonces arrivent chaque jour."
          : "Vous êtes à jour. Revoyez toutes les annonces depuis le début."}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-1 inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-[13px] font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/15 active:scale-[0.97]"
      >
        <RotateCcw className="size-4" strokeWidth={2.4} />
        {empty ? "Actualiser" : "Tout revoir"}
      </button>
    </div>
  );
}
