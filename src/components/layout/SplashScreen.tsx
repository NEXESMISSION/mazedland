"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const SHOWN_KEY = "batta:splash-shown";

/**
 * Phone-app-style splash screen — full-screen black with the BATTA
 * logo centered + softly pulsing. Plays once per browser session
 * (sessionStorage flag) so in-app navigation never re-triggers it.
 *
 * Behaviour:
 *   - SSR always renders the splash (`visible=true`) so the FIRST byte
 *     the user receives already shows the brand. No white flash before
 *     hydration.
 *   - On hydrate, if the splash has already played in this session
 *     (sessionStorage flag set), it unmounts immediately. No flash
 *     because React hydration replaces the DOM in the same tick.
 *   - On first play, the splash holds for ~1.1s, then fades out over
 *     400ms. After fade, it unmounts entirely so it doesn't intercept
 *     pointer events.
 *
 * Mounted in `[locale]/layout.tsx` above MobileShell so it covers
 * every page on first load — auth, KYC, anywhere.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // On hydration, check if we've already shown the splash this
    // session. If so, hide immediately — no flash because this fires
    // in the same render tick as hydration.
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(SHOWN_KEY) === "1";
    } catch {
      // Private mode / storage disabled — show every page load. Not ideal
      // but not broken.
    }

    if (alreadyShown) {
      setVisible(false);
      return;
    }

    // Mark as shown immediately so a fast nav-back during the splash
    // doesn't queue a second play.
    try {
      sessionStorage.setItem(SHOWN_KEY, "1");
    } catch {
      // ignore
    }

    // Hold for 1.1s, fade for 400ms, unmount.
    const fadeTimer = setTimeout(() => setFadeOut(true), 1100);
    const hideTimer = setTimeout(() => setVisible(false), 1500);
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
        "fixed inset-0 z-[100] flex items-center justify-center bg-black",
        "transition-opacity duration-[400ms] ease-out",
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100",
      )}
    >
      {/* Logo — centered, sized to ~55% of viewport width up to a cap.
          `animate-pulse` is a subtle breath, not a hard blink. */}
      <Image
        src="/logo.png"
        alt="Batta"
        width={480}
        height={320}
        priority
        className="h-auto w-[55vw] max-w-[320px] animate-pulse"
      />
    </div>
  );
}
