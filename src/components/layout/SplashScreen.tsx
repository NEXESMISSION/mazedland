"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SHOWN_KEY = "batta:splash-shown";

/**
 * First-load splash — centered Batta wordmark on the brand gradient
 * with a soft loading-dots animation underneath. Plays once per
 * browser session (sessionStorage flag); in-app navigation never
 * re-triggers it.
 *
 * The logo is a plain `<picture>` (no Next/Image) and is preloaded
 * in `<head>` so it paints with the very first HTML byte. The
 * splash fades out as soon as the rest of the shell is ready.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(SHOWN_KEY) === "1";
    } catch {
      // Private mode / storage disabled — show every page load.
    }

    if (alreadyShown) {
      setVisible(false);
      return;
    }

    try {
      sessionStorage.setItem(SHOWN_KEY, "1");
    } catch {
      // ignore
    }

    // Quick hold so the logo registers; the gradient + dots cover the
    // perceived wait until React + the home page paint.
    const fadeTimer = setTimeout(() => setFadeOut(true), 650);
    const hideTimer = setTimeout(() => setVisible(false), 1050);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden",
        "batta-gradient-gold",
        "transition-opacity duration-[400ms] ease-out",
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100",
      )}
    >
      {/* Soft white halos for depth — same recipe as the favorites
          empty-state and the notification modal header. */}
      <div className="batta-gradient-blob batta-gradient-blob-lg -top-20 -right-12" />
      <div className="batta-gradient-blob batta-gradient-blob-lg -bottom-24 -left-16" />

      {/* Logo — preloaded in <head>, served via <picture> so AVIF
          (4 KB) wins where supported, with WebP fallback. The white
          frosted plate gives the dark wordmark a clean stage on the
          blue gradient. */}
      <div className="relative animate-[batta-float-up_500ms_ease-out_both]">
        <div className="rounded-3xl bg-white/95 px-7 py-5 shadow-[var(--shadow-lg)] ring-1 ring-white/40 backdrop-blur-sm">
          <picture>
            <source srcSet="/logo.avif" type="image/avif" />
            <source srcSet="/logo.webp" type="image/webp" />
            <img
              src="/logo.png"
              alt="Batta"
              width={528}
              height={164}
              decoding="async"
              fetchPriority="high"
              className="h-16 w-auto sm:h-20"
            />
          </picture>
        </div>
      </div>

      {/* Loading dots */}
      <div
        className="relative mt-10 flex items-center gap-2"
        role="status"
        aria-label="Chargement"
      >
        <span className="batta-splash-dot" style={{ animationDelay: "0ms" }} />
        <span className="batta-splash-dot" style={{ animationDelay: "160ms" }} />
        <span className="batta-splash-dot" style={{ animationDelay: "320ms" }} />
      </div>
    </div>
  );
}
