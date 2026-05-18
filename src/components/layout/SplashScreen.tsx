"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SHOWN_KEY = "batta:splash-shown";

/**
 * First-load splash — full-screen skeleton (header bar + card grid)
 * that mirrors the home shell, so the swap to real content doesn't
 * jump. Plays once per browser session (sessionStorage flag); in-app
 * navigation never re-triggers it.
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

    const fadeTimer = setTimeout(() => setFadeOut(true), 700);
    const hideTimer = setTimeout(() => setVisible(false), 1100);
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
        "fixed inset-0 z-[100] overflow-hidden bg-white",
        "transition-opacity duration-[400ms] ease-out",
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100",
      )}
    >
      <div className="mx-auto max-w-[var(--max-w)] px-4 pt-5 lg:max-w-[var(--max-w-wide)]">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton h-2 w-20" />
            <div className="skeleton h-6 w-40" />
          </div>
          <div className="skeleton h-5 w-16" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="block">
              <div className="skeleton aspect-[4/5] rounded-2xl" />
              <div className="space-y-2 px-1 pt-3">
                <div className="skeleton h-3.5 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
