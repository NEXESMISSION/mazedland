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

const AUTO_INTERVAL_MS = 2000;
/**
 * Pause auto-advance for this many ms after a user-triggered prev/next.
 * Prevents the "user just tapped right, half a second later it snaps
 * forward again" jank.
 */
const USER_NAV_PAUSE_MS = 5000;

/**
 * Cinematic hero with auto-rotating photos. Loops every 2s, fades
 * between frames, exposes prev/next arrows and tap-to-jump dots.
 *
 * The server-rendered overlay content (LIVE chip, lot chip, title)
 * lives outside this component as a sibling — passed in via children
 * so SEO crawlers see it without waiting for hydration.
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
  const [index, setIndex] = useState(0);
  const pauseUntil = useRef(0);
  const count = photos.length;

  useEffect(() => {
    if (count <= 1) return;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntil.current) return;
      setIndex((i) => (i + 1) % count);
    }, AUTO_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [count]);

  function go(delta: number) {
    if (count <= 1) return;
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    setIndex((i) => (i + delta + count) % count);
  }

  function jumpTo(i: number) {
    pauseUntil.current = Date.now() + USER_NAV_PAUSE_MS;
    setIndex(i);
  }

  return (
    <div className="batta-photo-overlay relative">
      <div className="relative aspect-[4/5] overflow-hidden bg-surface-2 sm:aspect-[4/3]">
        {photos.length > 0 ? (
          photos.map((p, i) => {
            const src = propertyPhotoUrl(p.storage_path);
            const blur = IMAGE_BLUR_MAP[p.storage_path];
            return (
              <Image
                key={p.id}
                src={src}
                alt={alt}
                fill
                priority={i === 0}
                loading={i === 0 ? "eager" : "lazy"}
                sizes="(min-width: 1024px) 1100px, 100vw"
                placeholder={blur ? "blur" : "empty"}
                blurDataURL={blur}
                unoptimized={isStaticSeedPath(src)}
                className={`object-cover transition-opacity duration-700 ease-out ${
                  i === index ? "opacity-100 z-0" : "opacity-0 z-0"
                }`}
              />
            );
          })
        ) : (
          <div className="flex h-full items-center justify-center text-7xl text-foreground/15">
            🏛️
          </div>
        )}
      </div>

      {/* Overlay content — badges + title, server-rendered. */}
      {children}

      {/* Arrows — only show when there's more than one photo. */}
      {count > 1 && (
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

          {/* Dots */}
          <div className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur-md ring-1 ring-white/15">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                aria-label={t("gallery.goToPhoto", { n: i + 1 })}
                onClick={() => jumpTo(i)}
                className={`block h-1.5 rounded-full transition-all ${
                  i === index
                    ? "w-5 bg-white"
                    : "w-1.5 bg-white/55 hover:bg-white/85"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
