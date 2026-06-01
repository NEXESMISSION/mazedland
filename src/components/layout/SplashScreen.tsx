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

    // Brief brand flash only — the pages behind are static/fast now, so a
    // long splash just gets in the way. Start fading almost immediately and
    // remove it ~350ms in.
    const fadeTimer = setTimeout(() => setFadeOut(true), 150);
    const hideTimer = setTimeout(() => setVisible(false), 350);
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
        "transition-opacity duration-200 ease-out",
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100",
      )}
    >
      {/* Soft white halos for depth — same recipe as the favorites
          empty-state and the notification modal header. */}
      <div className="batta-gradient-blob batta-gradient-blob-lg -top-20 -right-12" />
      <div className="batta-gradient-blob batta-gradient-blob-lg -bottom-24 -left-16" />

      {/* Logo — preloaded in <head>, served via <picture> so AVIF
          (4 KB) wins where supported, with WebP fallback. The CSS
          filter (`brightness(0) invert(1)`) flips the dark wordmark
          to pure white so it reads directly on the gradient without
          any backing plate. */}
      <picture className="relative animate-[batta-float-up_220ms_ease-out_both]">
        <source srcSet="/logo.avif" type="image/avif" />
        <source srcSet="/logo.webp" type="image/webp" />
        <img
          src="/logo.png"
          alt="Batta"
          width={528}
          height={164}
          decoding="async"
          fetchPriority="high"
          className="batta-splash-logo h-14 w-auto sm:h-16"
        />
      </picture>

      {/* Thin progress bar — a single white sliver runs left to right
          under the logo. Cleaner than bouncing dots and on-brand with
          the linear/stripe-style premium loaders. */}
      <div
        className="relative mt-10 h-[2px] w-40 overflow-hidden rounded-full bg-white/20"
        role="status"
        aria-label="Chargement"
      >
        <span className="batta-splash-bar" />
      </div>
    </div>
  );
}
