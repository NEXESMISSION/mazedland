"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getImageProps } from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import { AD_IMAGE } from "@/lib/ads/ads";

/** One banner, resolved on the server (AdSlot). */
export type Banner = {
  id: string;
  /** The fr/ar title, or the advertiser's name. */
  alt: string;
  src: string;
  /** The 2:1 phone version; the wide image is used when there is none. */
  mobileSrc: string | null;
};

/**
 * The banners of one advertising space, one at a time.
 *
 * Crossfades to the next every `ads_rotate_seconds`, and holds still whenever
 * someone is looking closely — the pointer over it, a finger on it, the
 * keyboard in it — and whenever nobody can see it: scrolled away, or in a
 * background tab. With reduced motion asked for, it never moves on its own;
 * the dots and a swipe still do.
 *
 * A view is counted once per banner per page, when at least half of it has
 * been on screen for a second (the usual definition of a viewable ad): the
 * banner below the fold that nobody reached was not seen, and neither was
 * the one the rotation swept past while the reader looked elsewhere.
 *
 * The box has a fixed ratio from the first paint — 4:1 wide, 2:1 on a phone
 * when a phone image exists — so a banner arriving never pushes the page.
 * One link wraps the stack and follows the banner on show, so keyboard focus
 * stays put while the banners change under it.
 */

/** Below Tailwind's `sm`: where the box turns 2:1 and the phone image applies. */
const NARROW = "(max-width: 639px)";
/** The widest container a slot sits in (the catalogue, max-w-6xl). A slot in
 *  a narrower column says so, or the phone downloads a desktop image. */
const WIDE_SIZES = "(min-width: 1152px) 1152px, 100vw";
const SWIPE_PX = 40;
const SEEN_MS = 1000;

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function subscribeReduce(onChange: () => void) {
  const m = window.matchMedia(REDUCE);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** Read from the browser as it changes, without a state write in an effect. */
function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => true);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE).matches, () => false);
}

/** A beacon outlives the page: a reader who taps away at once still counts. */
function sendView(id: string) {
  const url = `/api/ads/${id}/view`;
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch {
    /* refused (size, policy) — the fetch below is the same request */
  }
  void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
}

export function AdRotator({ banners, sizes = WIDE_SIZES }: { banners: Banner[]; sizes?: string }) {
  const t = useTranslations("ads");
  const rtl = useLocale() === "ar";
  const seconds = useSetting("ads_rotate_seconds");
  const total = banners.length;

  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const [inView, setInView] = useState(false);
  const pageVisible = usePageVisible();
  const reduced = useReducedMotion();

  const boxRef = useRef<HTMLDivElement>(null);
  const counted = useRef(new Set<string>());
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);

  const current = banners[Math.min(index, total - 1)];
  const currentId = current?.id;
  const watching = inView && pageVisible;
  const rotating = total > 1 && !reduced && watching && !hovered && !focused && !touching;

  // « Seen » is half the box on screen.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.5),
      { threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The view, once per banner. Marked when the beacon goes, not when the
  // timer starts: React runs an effect, cleans it up and runs it again, and a
  // mark set up front would have cancelled the only count.
  useEffect(() => {
    if (!watching || !currentId || counted.current.has(currentId)) return;
    const timer = window.setTimeout(() => {
      counted.current.add(currentId);
      sendView(currentId);
    }, SEEN_MS);
    return () => window.clearTimeout(timer);
  }, [watching, currentId]);

  // The next banner. A timeout re-armed on every change rather than an
  // interval: a banner picked by hand gets its full time on screen.
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % total), Math.max(3, seconds) * 1000);
    return () => window.clearTimeout(timer);
  }, [rotating, index, seconds, total]);

  if (!current) return null;

  const go = (n: number) => setIndex(((n % total) + total) % total);
  // Arabic reads right to left: there the next banner is the one to the
  // left — the arrow on the left, the key on the left, a swipe to the right.
  const step = (towardEnd: boolean) => go(index + (towardEnd ? 1 : -1));

  const anyMobile = banners.some((b) => b.mobileSrc);

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
    setTouching(true);
  }

  function onPointerUp(e: React.PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    setTouching(false);
    if (!start || start.id !== e.pointerId || total < 2) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    swiped.current = true;
    step(rtl ? dx > 0 : dx < 0);
  }

  return (
    <section
      aria-roledescription={t("carousel")}
      aria-label={t("region")}
      className="min-w-0"
      // The keyboard's focus only: a dot tapped on a phone keeps the focus,
      // and would otherwise stop the rotation for the rest of the visit.
      onFocus={(e) => {
        try {
          if (e.target.matches(":focus-visible")) setFocused(true);
        } catch {
          setFocused(true);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (total < 2 || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        step(e.key === (rtl ? "ArrowLeft" : "ArrowRight"));
      }}
    >
      <div
        ref={boxRef}
        className={`relative overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border ${
          anyMobile ? "aspect-[2/1] sm:aspect-[4/1]" : "aspect-[4/1]"
        }`}
        // Vertical scrolling stays the browser's; a sideways swipe is ours.
        style={{ touchAction: "pan-y" }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
          setTouching(false);
        }}
        onClickCapture={(e) => {
          // A swipe that ends on the banner is not a tap on it.
          if (swiped.current) {
            swiped.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <a
          href={`/api/ads/${current.id}/click`}
          target="_blank"
          rel="sponsored noopener"
          className="absolute inset-0 block rounded-2xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--gold)]"
        >
          {banners.map((b, i) => (
            <BannerPicture
              key={b.id}
              banner={b}
              shown={i === index}
              sizes={sizes}
              // A wide image in the 2:1 phone box is shown whole, not cropped
              // to its middle half.
              fit={b.mobileSrc || !anyMobile ? "object-cover" : "object-contain sm:object-cover"}
            />
          ))}
          <span className="sr-only">{t("newTab")}</span>
        </a>

        {/* Ads must say they are ads — on every banner, where it is read. */}
        <span className="pointer-events-none absolute start-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
          {t("label")}
        </span>

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(false)}
              aria-label={t("previous")}
              className="absolute start-2 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white transition hover:bg-black/60 sm:grid"
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={() => step(true)}
              aria-label={t("next")}
              className="absolute end-2 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white transition hover:bg-black/60 sm:grid"
            >
              <ChevronRight className="size-4 rtl:-scale-x-100" strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div className="mt-1.5 flex justify-center">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => go(i)}
              aria-label={t("goTo", { n: i + 1, total })}
              aria-current={i === index ? "true" : undefined}
              className="grid h-6 w-5 place-items-center"
            >
              <span
                className={`block h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                  i === index ? "w-4 bg-[var(--gold)]" : "w-1.5 bg-[var(--foreground-subtle)]"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The banner's image, the phone version on narrow screens. next/image has no
 * `<picture>`, so `getImageProps` gives each source the same resized,
 * AVIF/WebP-negotiated variants an `<Image>` would get.
 */
function BannerPicture({ banner, shown, fit, sizes }: { banner: Banner; shown: boolean; fit: string; sizes: string }) {
  const alt = shown ? banner.alt : "";
  const { props: wide } = getImageProps({
    src: banner.src,
    alt,
    width: AD_IMAGE.wide.width,
    height: AD_IMAGE.wide.height,
    sizes,
    quality: 75,
  });
  const narrow = banner.mobileSrc
    ? getImageProps({
        src: banner.mobileSrc,
        alt,
        width: AD_IMAGE.mobile.width,
        height: AD_IMAGE.mobile.height,
        sizes: "100vw",
        quality: 75,
      }).props
    : null;
  // The box sets the size; next/image's inline style would fight it.
  const { style: _style, ...img } = wide;

  return (
    // The banners not on show have an empty alt: the link is named by the one
    // that is, and a screen reader does not read the others.
    <picture
      className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {narrow && <source media={NARROW} srcSet={narrow.srcSet} sizes={narrow.sizes} />}
      <img {...img} alt={alt} draggable={false} className={`size-full ${fit}`} />
    </picture>
  );
}
