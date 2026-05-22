"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { isStaticSeedPath } from "@/lib/imageUrl";

export type HeroSlide = {
  /** Unique id for keying. Auction id when sourced from DB, "fallback-N" otherwise. */
  id: string;
  /** Absolute or pathed image URL. Pre-resolved server-side. */
  imageUrl: string | null;
  /** Top overlay line — small, uppercase tracking-wide. */
  eyebrow: string;
  /** Big headline. */
  title: string;
  /** Optional second line under the title. */
  subtitle?: string;
  /** Tap target — wraps the whole slide. Locale-prefixed via next-intl. */
  href: string;
  /** CTA text on the corner badge (defaults to "View"). */
  ctaLabel?: string;
  /** "brand" → dedicated welcome layout (big live-count stat, gold rule,
   *  centered CTA). Anything else uses the standard photo-overlay slide. */
  kind?: "brand";
  /** Live auction count, surfaced as the hero stat on a brand slide. */
  liveCount?: number;
};

/**
 * Auto-advancing hero carousel.
 *
 * Behaviour summary:
 *   - 5 s auto-advance, paused for 6 s after any user interaction.
 *   - Pointer events drive a LIVE drag (the track follows the finger /
 *     mouse). Works for touch + mouse uniformly.
 *   - Release snaps to the nearest slide using a 1/4-width threshold.
 *   - If the pointer moved more than 5 px between down and up, the
 *     ensuing click on the slide's `<Link>` is suppressed so dragging
 *     doesn't accidentally navigate.
 *   - Keyboard ←/→ moves between slides when the banner has focus.
 *   - RTL flips the direction so swiping right goes back, not forward.
 *
 * SSR: the first slide renders server-side; only that slide is marked
 * `priority` for the LCP. Other slides lazy-load as they scroll in.
 */
export function HeroBanner({
  slides,
  intervalMs = 3500,
  resumeAfterMs = 6000,
  isRTL = false,
}: {
  slides: HeroSlide[];
  intervalMs?: number;
  resumeAfterMs?: number;
  isRTL?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const lastInteractionAt = useRef(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pointerStartX = useRef<number | null>(null);
  const pointerStartId = useRef<number | null>(null);
  const draggedFar = useRef(false);
  const total = slides.length;

  // Auto-advance. Pauses while dragging, hovering (desktop affordance),
  // or within the cooldown after the last user interaction.
  useEffect(() => {
    if (total <= 1) return;
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const id = window.setInterval(() => {
      if (isDragging) return;
      if (isHovering) return;
      if (Date.now() - lastInteractionAt.current < resumeAfterMs) return;
      setIndex((i) => (i + 1) % total);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [total, intervalMs, resumeAfterMs, isDragging, isHovering]);

  function jumpTo(next: number) {
    lastInteractionAt.current = Date.now();
    setIndex(((next % total) + total) % total);
  }

  function onPointerDown(e: React.PointerEvent) {
    // Only react to primary mouse button or any touch/pen press.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerStartX.current = e.clientX;
    pointerStartId.current = e.pointerId;
    draggedFar.current = false;
    setIsDragging(true);
    lastInteractionAt.current = Date.now();
    // Capture the pointer so we keep getting move events even if the
    // cursor leaves the element (mouse drag off the side of the slide).
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointerStartX.current === null) return;
    if (pointerStartId.current !== e.pointerId) return;
    const dx = e.clientX - pointerStartX.current;
    if (Math.abs(dx) > 5) draggedFar.current = true;
    // Cap the drag distance so the user can't drag the slide off
    // its rails on a long swipe.
    const width = trackRef.current?.offsetWidth ?? 1;
    const capped = Math.max(-width, Math.min(width, dx));
    setDragPx(capped);
  }

  function endPointer(e: React.PointerEvent) {
    if (pointerStartId.current !== e.pointerId) return;
    const dx = dragPx;
    const width = trackRef.current?.offsetWidth ?? 1;
    pointerStartX.current = null;
    pointerStartId.current = null;
    setIsDragging(false);
    setDragPx(0);
    // Snap threshold: 1/4 of the slide width, or the smaller 40 px
    // floor for very narrow viewports. RTL flips the direction.
    const threshold = Math.max(40, width / 4);
    if (Math.abs(dx) >= threshold) {
      const forward = isRTL ? dx > 0 : dx < 0;
      setIndex((i) => (forward ? (i + 1) % total : (i - 1 + total) % total));
    }
  }

  // Suppress the slide's <Link> click if the user actually dragged —
  // otherwise a 200 px swipe navigates away the moment the finger lifts.
  function onClickCapture(e: React.MouseEvent) {
    if (draggedFar.current) {
      e.preventDefault();
      e.stopPropagation();
      draggedFar.current = false;
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      jumpTo(isRTL ? index - 1 : index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      jumpTo(isRTL ? index + 1 : index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      jumpTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      jumpTo(total - 1);
    }
  }

  if (total === 0) return null;

  // Composite transform: base position (index * 100%) + live drag (px).
  // We use a percent for the snap and a px for the drag so the drag
  // distance reads correctly regardless of viewport width.
  const baseDirection = isRTL ? 1 : -1;
  const basePercent = baseDirection * index * 100;

  return (
    <section
      className="relative px-4 pt-4"
      aria-roledescription="carousel"
      aria-label="Featured auctions"
    >
      <div
        ref={trackRef}
        tabIndex={0}
        role="group"
        className="relative overflow-hidden rounded-2xl ring-1 ring-gold/20 outline-none focus-visible:ring-2 focus-visible:ring-gold/60 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onKeyDown={onKeyDown}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className={`flex ${
            isDragging ? "" : "transition-transform duration-700 ease-out"
          }`}
          style={{
            // base + live drag offset (drag in px, base in %).
            transform: `translate3d(calc(${basePercent}% + ${dragPx}px), 0, 0)`,
            cursor: isDragging ? "grabbing" : "grab",
          }}
          onClickCapture={onClickCapture}
          aria-live="polite"
        >
          {slides.map((slide, i) => (
            <SlideCard
              key={slide.id}
              slide={slide}
              isRTL={isRTL}
              priority={i === 0}
              active={i === index}
            />
          ))}
        </div>

        {/* Dot indicator — clickable, jumps directly to that slide. */}
        {total > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={`dot-${s.id}`}
                type="button"
                aria-label={`Slide ${i + 1} of ${total}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => jumpTo(i)}
                className={`pointer-events-auto h-1.5 rounded-full transition-all duration-300 ${
                  i === index
                    ? "w-6 bg-gold shadow-[0_0_6px_rgba(30,58,138,0.35)]"
                    : "w-1.5 bg-white/40 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SlideCard({
  slide,
  isRTL,
  priority,
  active,
}: {
  slide: HeroSlide;
  isRTL: boolean;
  priority: boolean;
  active: boolean;
}) {
  // The brand slide gets a dedicated layout — see BrandSlide below.
  // Photo slides keep the original photo + bottom-text composition.
  if (slide.kind === "brand") {
    return (
      <BrandSlide slide={slide} isRTL={isRTL} active={active} />
    );
  }
  return <PhotoSlide slide={slide} isRTL={isRTL} priority={priority} active={active} />;
}

function PhotoSlide({
  slide,
  isRTL,
  priority,
  active,
}: {
  slide: HeroSlide;
  isRTL: boolean;
  priority: boolean;
  active: boolean;
}) {
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = !!slide.imageUrl && !imageBroken;

  return (
    <Link
      href={slide.href as `/${string}`}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      className="group relative block aspect-[16/11] w-full shrink-0 overflow-hidden bg-surface-2"
      style={{ minWidth: "100%" }}
      draggable={false}
    >
      {showImage ? (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--gold-deep)] via-[var(--gold)] to-[var(--gold-deep)]" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--gold-deep)] via-[var(--gold)] to-[var(--gold-deep)]" />
      )}

      {showImage && (
        <Image
          src={slide.imageUrl!}
          alt=""
          fill
          sizes="(min-width: 640px) 640px, 100vw"
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          onError={() => setImageBroken(true)}
          unoptimized={isStaticSeedPath(slide.imageUrl!)}
          className="object-cover transition-transform duration-[6000ms] ease-out group-hover:scale-105"
          draggable={false}
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/15" />

      <div
        className={`absolute inset-0 z-[1] flex flex-col justify-end p-5 ${
          isRTL ? "items-end text-right" : "items-start text-left"
        }`}
      >
        {slide.eyebrow && (
          <span className="batta-eyebrow inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 backdrop-blur-sm">
            <span aria-hidden className="size-1.5 rounded-full bg-gold pulse-gold" />
            {slide.eyebrow}
          </span>
        )}
        <h2
          className={`mt-2.5 text-balance text-[22px] font-extrabold leading-[1.1] tracking-tight text-white drop-shadow-md md:text-[28px] ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          {slide.title}
        </h2>
        {slide.subtitle && (
          <p className="mt-1.5 max-w-[90%] text-[12px] font-medium leading-snug text-white/80">
            {slide.subtitle}
          </p>
        )}
      </div>

      <span className="batta-gold-fill absolute top-3 z-[1] inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)] ltr:right-3 rtl:left-3">
        {slide.ctaLabel ?? "View"}
      </span>
    </Link>
  );
}

/**
 * Brand-pitch slide. Replaces the "logo as background + same caption
 * layout as photo slides" treatment with a dedicated luxe composition:
 *
 *   • Deep navy gradient with a gold radial bloom + concentric arcs.
 *   • The live auction count as the hero typographic figure when there
 *     is one — the only number on a homepage that says "real market".
 *   • Pretty headline split: marketing line in white, "Tunisia" word
 *     pulled out in gradient gold so the eye lands somewhere.
 *   • Single centered gold CTA pill instead of a disconnected corner
 *     badge — the slide reads as one composition.
 */
function BrandSlide({
  slide,
  isRTL,
  active,
}: {
  slide: HeroSlide;
  isRTL: boolean;
  active: boolean;
}) {
  const hasLiveCount = (slide.liveCount ?? 0) > 0;
  return (
    <Link
      href={slide.href as `/${string}`}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      className="group relative block aspect-[16/11] w-full shrink-0 overflow-hidden bg-[#0a1530]"
      style={{ minWidth: "100%" }}
      draggable={false}
    >
      {/* Deep navy base with a warm gold bloom up top — sets the luxe
          stage without an external image. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 20%, rgba(212, 175, 55, 0.22) 0%, rgba(30, 58, 138, 0.0) 60%), linear-gradient(180deg, #0d1b3d 0%, #08122a 100%)",
        }}
      />
      {/* Concentric gold arcs behind the headline — pure CSS, no asset. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 50% 32%, transparent 96px, rgba(212,175,55,0.18) 97px, transparent 99px)",
            "radial-gradient(circle at 50% 32%, transparent 138px, rgba(212,175,55,0.12) 139px, transparent 141px)",
            "radial-gradient(circle at 50% 32%, transparent 188px, rgba(212,175,55,0.07) 189px, transparent 191px)",
          ].join(", "),
        }}
      />
      {/* Gold hairline along the bottom — finishing accent. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-[#d4af37] to-transparent"
      />

      {/* Three-row vertical layout: eyebrow up top, hero stat + headline
          dead-centered, CTA pinned to the bottom with safe space above
          the pagination dots. Using justify-between (with a flex-1
          centered middle) gives consistent rhythm whether or not
          `hasLiveCount` is true. */}
      <div
        className={`absolute inset-0 z-[1] flex flex-col items-center px-5 pt-4 pb-9 text-center ${
          isRTL ? "font-arabic" : ""
        }`}
      >
        {/* Top — eyebrow. */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/90 backdrop-blur-sm">
          {hasLiveCount && (
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-red-500 pulse-gold"
              style={{ boxShadow: "0 0 8px rgba(239,68,68,0.6)" }}
            />
          )}
          {hasLiveCount ? "En direct" : "Batta · Tunisie"}
        </span>

        {/* Middle — stretches to fill, centers its content vertically. */}
        <div className="flex flex-1 flex-col items-center justify-center">
          {/* Hero stat: big number stacked over its tiny label, so the
              count owns the optical center instead of having a small
              word floating next to it on the baseline. */}
          {hasLiveCount && (
            <div className="flex flex-col items-center leading-none">
              <span
                className="batta-tabular text-[56px] font-black leading-[0.95] tracking-tight md:text-[64px]"
                style={{
                  background:
                    "linear-gradient(180deg, #f7e4a3 0%, #d4af37 55%, #b08a1f 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  textShadow: "0 4px 24px rgba(212,175,55,0.25)",
                }}
              >
                {slide.liveCount}
              </span>
              <span className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.32em] text-white/65">
                Enchères
              </span>
            </div>
          )}

          {/* Headline — gold for the last word so the eye lands. */}
          <h2 className="mt-3 max-w-[18ch] text-balance text-[20px] font-extrabold leading-[1.1] tracking-tight text-white md:text-[24px]">
            La maison des enchères{" "}
            <span
              style={{
                background:
                  "linear-gradient(180deg, #f7e4a3 0%, #d4af37 60%, #b08a1f 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              tunisiennes
            </span>
          </h2>

          {/* Trust line — three values with gold dot separators. */}
          <div className="mt-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
            Transparence
            <span aria-hidden className="size-1 rounded-full bg-[#d4af37]" />
            Rapidité
            <span aria-hidden className="size-1 rounded-full bg-[#d4af37]" />
            Confiance
          </div>
        </div>

        {/* Bottom — CTA. The pb-9 on the parent leaves ~28 px of clear
            space below this pill so the carousel's pagination dots
            (positioned at bottom-3 inside the track) no longer overlap
            the button. */}
        <span
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-6 text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-[#0a1530] shadow-[0_12px_28px_-8px_rgba(212,175,55,0.65)] ring-1 ring-black/10 transition group-hover:scale-[1.03]"
          style={{
            background:
              "linear-gradient(180deg, #f7e4a3 0%, #d4af37 55%, #a8841e 100%)",
          }}
        >
          {slide.ctaLabel ?? "Explorer"}
          <span aria-hidden className="text-[14px] leading-none">→</span>
        </span>
      </div>
    </Link>
  );
}
