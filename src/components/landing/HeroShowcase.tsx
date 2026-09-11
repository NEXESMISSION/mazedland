"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { HiddenAt } from "@/components/ui/HiddenAt";
import { LiveCountdown } from "@/components/landing/LiveCountdown";
import { MapPin, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";

export type ShowcaseSlide = {
  /** Auction id — used as the React key and to build the detail href. */
  id: string;
  /** Pre-resolved absolute / pathed cover image. */
  imageUrl: string | null;
  /** Locale-prefixed via next-intl. */
  href: string;
  /** Listing governorate (already a display string). */
  governorate: string;
  /** Listing headline. */
  title: string;
  /** Locale-formatted figure, e.g. "485 000". */
  priceLabel: string;
  /** ISO deadline for the live countdown pill. */
  endsAt: string | null;
  /** Auction-era: drove a red LIVE chip. Always false now — see the note
   *  in HomeDesktop's showcase builder. Kept so the chip logic reads plainly
   *  rather than being deleted and half-remembered. */
  isLive: boolean;
};

/**
 * Desktop hero showcase — the right-hand panel of the home hero.
 *
 * Replaces the raw photo carousel (which surfaced the listing photos'
 * own watermarks + a colliding corner badge) with a single framed lot
 * card: cover photo under a strong bottom gradient, a glass info panel
 * with type/LIVE chips, a live countdown, the title, the price, and a
 * dedicated "Voir" action. Auto-advances every 3s (never pauses on
 * hover), crossfades between lots, offers prev/next arrows + dots, and
 * falls back to a brand panel when the DB has nothing live so the hero
 * never renders empty.
 */
export function HeroShowcase({
  slides,
  isRTL = false,
  brand,
  intervalMs = 3000,
  priority = false,
  hiddenAt,
}: {
  slides: ShowcaseSlide[];
  isRTL?: boolean;
  /** Shown when there are no live lots — keeps the hero from going blank. */
  brand: { title: string; slogan: string; cta: string; href: string };
  intervalMs?: number;
  /** Load the first photo eagerly at high priority — the showcase is the LCP. */
  priority?: boolean;
  /** Media query at which CSS hides the showcase's tree (see HiddenAt). */
  hiddenAt?: string;
}) {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const total = slides.length;
  const safeIndex = total > 0 ? index % total : 0;

  // Auto-advance — keeps running on hover (only reduced-motion stops it).
  // Manual arrows/dots just reposition; they don't halt the rotation.
  useEffect(() => {
    if (total <= 1) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Paused while out of view — which includes every phone, where the desktop
    // tree this lives in is display:none and was re-rendering every 3 seconds.
    const root = rootRef.current;
    let inView = true;
    const observer =
      root && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
          })
        : null;
    if (observer && root) observer.observe(root);
    const id = window.setInterval(() => {
      if (!inView || document.hidden) return;
      setIndex((i) => (i + 1) % total);
    }, intervalMs);
    return () => {
      window.clearInterval(id);
      observer?.disconnect();
    };
  }, [total, intervalMs]);

  if (total === 0) {
    return <BrandPanel brand={brand} isRTL={isRTL} />;
  }

  return (
    <div ref={rootRef} className="group/showcase relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-surface-2 ring-1 ring-border shadow-[0_28px_60px_-26px_rgba(15,23,42,0.45)]">
      {slides.map((slide, i) => {
        const active = i === safeIndex;
        return (
          <Link
            key={slide.id}
            href={slide.href as `/${string}`}
            aria-hidden={!active}
            tabIndex={active ? 0 : -1}
            className={`absolute inset-0 block transition-opacity duration-700 ease-out ${
              active ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            draggable={false}
          >
            <SlideBody
              slide={slide}
              active={active}
              priority={priority && i === 0}
              hiddenAt={i === 0 ? hiddenAt : undefined}
              isRTL={isRTL}
            />
          </Link>
        );
      })}

      {/* Prev / next arrows — let the visitor step back to a lot they
          missed without waiting for it to come around again. */}
      {total > 1 && (
        <>
          <button
            type="button"
            aria-label="Bien précédent"
            onClick={() => setIndex((i) => (i - 1 + total) % total)}
            className="absolute start-3 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/70"
          >
            <ChevronLeft className="size-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            aria-label="Bien suivant"
            onClick={() => setIndex((i) => (i + 1) % total)}
            className="absolute end-3 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/70"
          >
            <ChevronRight className="size-5" strokeWidth={2.5} />
          </button>
        </>
      )}

      {/* Dot indicators — sit above the photo, clear of the info panel. Each
          dot is drawn inside a 24px button: the 6px dot alone was too small a
          target (WCAG 2.5.8). */}
      {total > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
          {slides.map((s, i) => (
            <button
              key={`dot-${s.id}`}
              type="button"
              aria-label={`Bien ${i + 1} sur ${total}`}
              aria-current={i === safeIndex ? "true" : undefined}
              onClick={() => setIndex(i)}
              className="group/dot pointer-events-auto grid h-6 min-w-6 place-items-center rounded-full px-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <span
                aria-hidden
                className={`block h-1.5 rounded-full transition-all duration-300 ${
                  i === safeIndex
                    ? "w-6 bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
                    : "w-1.5 bg-white/45 group-hover/dot:bg-white/70"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SlideBody({
  slide,
  active,
  priority,
  hiddenAt,
  isRTL,
}: {
  slide: ShowcaseSlide;
  active: boolean;
  priority: boolean;
  hiddenAt?: string;
  isRTL: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const photo =
    slide.imageUrl && !broken ? (
      <Image
        src={slide.imageUrl}
        alt=""
        fill
        sizes="(min-width: 1024px) 600px, 100vw"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        onError={() => setBroken(true)}
        className={`object-cover transition-transform duration-[8000ms] ease-out ${
          active ? "scale-105" : "scale-100"
        }`}
        draggable={false}
      />
    ) : null;

  return (
    <>
      {/* Base wash so a missing / broken photo still reads as a brand tile.
          Warm paper, not the old navy: with no photo on top this IS the tile,
          and a navy slab is the one colour the brand does not contain. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#fffdf7] to-[#efe5d2]" />

      {photo && hiddenAt ? (
        <HiddenAt media={hiddenAt} className="absolute inset-0">
          {photo}
        </HiddenAt>
      ) : (
        photo
      )}

      {/* Strong bottom gradient — also masks any watermark / price text
          burned into the source photo near its lower edge. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />

      {/* Top chips — status on the start side, countdown on the end. The
          countdown only renders when `endsAt` is set, which a fixed-price
          annonce never sets. */}
      <div className="absolute inset-x-0 top-4 z-10 flex items-start justify-between px-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
          {slide.isLive && (
            <span className="mazed-pulse-dot size-1.5 rounded-full bg-red-500 text-red-500/40" />
          )}
          {slide.isLive ? "En direct" : "À vendre"}
        </span>
        {slide.endsAt && (
          <span className="shrink-0 drop-shadow">
            <LiveCountdown endsAt={slide.endsAt} compact />
          </span>
        )}
      </div>

      {/* Info panel — title, location, price + action. */}
      <div className={`absolute inset-x-0 bottom-0 z-10 p-5 ${isRTL ? "text-right" : "text-left"}`}>
        <h2
          className={`text-balance text-[20px] font-extrabold leading-[1.15] tracking-tight text-white drop-shadow ${
            isRTL ? "font-arabic" : ""
          }`}
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {slide.title}
        </h2>
        <div className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-white/80">
          <MapPin className="size-3.5" strokeWidth={2} />
          <span className="truncate">{slide.governorate}</span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
              Prix
            </div>
            <div className="mazed-tabular mt-0.5 text-[26px] font-black leading-none text-white">
              {slide.priceLabel}
              <span className="ms-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">
                TND
              </span>
            </div>
          </div>
          <span className="mazed-gold-fill inline-flex shrink-0 items-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.12em] shadow-[var(--shadow-gold)] ring-1 ring-black/10 transition group-hover/showcase:scale-[1.03]">
            Voir
            <ArrowUpRight className="size-4" strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </>
  );
}

/** Live-empty fallback — a self-contained navy brand panel. */
function BrandPanel({
  brand,
  isRTL,
}: {
  brand: { title: string; slogan: string; cta: string; href: string };
  isRTL: boolean;
}) {
  return (
    <Link
      href={brand.href as `/${string}`}
      className="relative flex aspect-[4/3] w-full flex-col items-center justify-center overflow-hidden rounded-3xl p-8 text-center ring-1 ring-gold/25 shadow-[var(--shadow-lg)]"
      style={{
        background:
          "radial-gradient(70% 60% at 50% 25%, rgba(184,130,54,0.18) 0%, rgba(184,130,54,0) 62%), linear-gradient(180deg, #fffdf7 0%, #f4ecdd 100%)",
      }}
    >
      <h2
        className={`max-w-[18ch] text-balance text-[26px] font-extrabold leading-[1.12] tracking-tight text-foreground ${
          isRTL ? "font-arabic" : ""
        }`}
      >
        {brand.title}
      </h2>
      <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted">{brand.slogan}</p>
      <span className="mazed-gold-fill mt-6 inline-flex items-center gap-1.5 rounded-full px-6 py-3 text-[12px] font-extrabold uppercase tracking-[0.14em] shadow-[var(--shadow-gold)] ring-1 ring-black/10">
        {brand.cta}
        <ArrowUpRight className="size-4" strokeWidth={2.5} />
      </span>
    </Link>
  );
}
