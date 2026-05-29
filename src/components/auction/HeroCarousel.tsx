"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { propertyPhotoUrl, isStaticSeedPath } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";

type Photo = {
  id: string;
  storage_path: string;
};

// Auto-advance cadence — a calm gallery pace (the old 1.5s read as a
// frantic flicker). 4.5s gives each photo time to register.
const AUTO_INTERVAL_MS = 4500;
// Pause auto-advance for this long after a manual prev/next/swipe/thumb tap.
const USER_NAV_PAUSE_MS = 6000;
// Swipe distance (px) that counts as a slide gesture.
const SWIPE_THRESHOLD = 40;

/**
 * Cinematic hero with auto-sliding photos.
 *
 *   - Real horizontal SLIDE (translateX track), not a cross-fade.
 *   - Seamless infinite loop: the first photo is cloned at the end, and we
 *     snap back to it without animation once the slide lands on the clone.
 *   - Auto-advances every 1.5s; pauses briefly after any manual interaction.
 *   - Swipe left/right on touch, arrows on desktop, clickable thumbnail strip.
 *
 * The server-rendered overlay (LIVE chip, lot chip, title) is passed in via
 * `children` so crawlers see it without waiting for hydration.
 */
export function HeroCarousel({
  photos,
  alt,
  children,
}: {
  photos: Photo[];
  alt: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations();
  const count = photos.length;
  const loop = count > 1;
  // Clone the first photo at the tail for a seamless wrap.
  const slides = loop ? [...photos, photos[0]] : photos;

  const [index, setIndex] = useState(0);
  const [anim, setAnim] = useState(true);
  const pauseUntil = useRef(0);
  const touchX = useRef<number | null>(null);

  const activeDot = count > 0 ? index % count : 0;

  // Auto-advance.
  useEffect(() => {
    if (!loop) return;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntil.current) return;
      setAnim(true);
      setIndex((i) => i + 1);
    }, AUTO_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loop]);

  // Re-enable the transition the frame after a no-anim snap-back.
  useEffect(() => {
    if (anim) return;
    const id = requestAnimationFrame(() => setAnim(true));
    return () => cancelAnimationFrame(id);
  }, [anim]);

  function onTransitionEnd() {
    // Landed on the cloned first photo → jump back to the real first
    // without animating, so the loop is invisible.
    if (index >= count) {
      setAnim(false);
      setIndex(0);
    }
  }

  function go(delta: number) {
    if (!loop) return;
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    setAnim(true);
    setIndex((i) => {
      const n = i + delta;
      if (n < 0) return count - 1;
      if (n > count) return 0;
      return n;
    });
  }

  function jumpTo(i: number) {
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    setAnim(true);
    setIndex(i);
  }

  return (
    <div>
      <div className="batta-photo-overlay relative">
        <div
          className="relative aspect-[4/5] overflow-hidden bg-surface-2 sm:aspect-[4/3]"
          style={{ touchAction: "pan-y" }}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
            pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
          }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > SWIPE_THRESHOLD) go(dx < 0 ? 1 : -1);
          }}
        >
          {count > 0 ? (
            <div
              className="flex h-full w-full"
              style={{
                transform: `translateX(-${index * 100}%)`,
                transition: anim ? "transform 500ms ease-out" : "none",
              }}
              onTransitionEnd={onTransitionEnd}
            >
              {slides.map((p, i) => {
                const src = propertyPhotoUrl(p.storage_path);
                const blur = IMAGE_BLUR_MAP[p.storage_path];
                return (
                  <div
                    key={`${p.id}-${i}`}
                    className="relative h-full w-full shrink-0"
                  >
                    <Image
                      src={src}
                      alt={alt}
                      fill
                      priority={i === 0}
                      loading={i === 0 ? "eager" : "lazy"}
                      sizes="(min-width: 1024px) 1100px, 100vw"
                      placeholder={blur ? "blur" : "empty"}
                      blurDataURL={blur}
                      unoptimized={isStaticSeedPath(src)}
                      className="object-cover"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-7xl text-foreground/15">
              🏛️
            </div>
          )}
        </div>

        {/* Overlay content — badges + title, server-rendered. */}
        {children}

        {/* Arrows + dots — only when there's more than one photo. */}
        {loop && (
          <>
            <button
              type="button"
              aria-label={t("gallery.prev")}
              onClick={() => go(-1)}
              className="absolute top-1/2 z-20 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md ring-1 ring-white/20 hover:bg-black/75 active:scale-95 transition-all ltr:left-3 rtl:right-3"
            >
              <ChevronLeft className="h-5 w-5 ltr:block rtl:hidden" strokeWidth={2.5} />
              <ChevronRight className="h-5 w-5 ltr:hidden rtl:block" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              aria-label={t("gallery.next")}
              onClick={() => go(1)}
              className="absolute top-1/2 z-20 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md ring-1 ring-white/20 hover:bg-black/75 active:scale-95 transition-all ltr:right-3 rtl:left-3"
            >
              <ChevronRight className="h-5 w-5 ltr:block rtl:hidden" strokeWidth={2.5} />
              <ChevronLeft className="h-5 w-5 ltr:hidden rtl:block" strokeWidth={2.5} />
            </button>

            <div className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur-md ring-1 ring-white/15">
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={t("gallery.goToPhoto", { n: i + 1 })}
                  onClick={() => jumpTo(i)}
                  className={`block h-1.5 rounded-full transition-all ${
                    i === activeDot
                      ? "w-5 bg-white"
                      : "w-1.5 bg-white/55 hover:bg-white/85"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Clickable thumbnail strip — jump straight to a photo. */}
      {loop && (
        <div className="hide-scrollbar flex gap-2 overflow-x-auto px-4 pt-3">
          {photos.map((p, i) => {
            const src = propertyPhotoUrl(p.storage_path);
            return (
              <button
                key={p.id}
                type="button"
                aria-label={t("gallery.goToPhoto", { n: i + 1 })}
                onClick={() => jumpTo(i)}
                className={`relative aspect-square w-16 shrink-0 overflow-hidden rounded-xl transition ${
                  i === activeDot
                    ? "ring-2 ring-[var(--gold)]"
                    : "opacity-70 ring-1 ring-border hover:opacity-100"
                }`}
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="64px"
                  unoptimized={isStaticSeedPath(src)}
                  className="object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
