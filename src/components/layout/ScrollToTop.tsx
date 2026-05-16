"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Force the window to scroll to (0, 0) on every route change.
 *
 * Next.js App Router normally handles this — but the `PullToRefresh`
 * wrapper applies `will-change: transform` to a child, creating a new
 * containing block that interferes with the built-in scroll restoration
 * in some browsers. Empirically: navigating from `/auctions` (long
 * scrolled list) to `/auctions/[id]` (detail page) left the detail
 * view positioned wherever the rail was — confusing and off-brand.
 *
 * Uses `behavior: "instant"` to bypass the global
 * `scroll-behavior: smooth`. The visible scroll-snap during navigation
 * felt sluggish; an instant top-of-page paint is the native-app feel
 * we want for tab switches.
 *
 * Trade-off: browser back/forward no longer restores the previous
 * scroll position (this overrides it). That matches the user's
 * explicit ask — "every page load from the top".
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
