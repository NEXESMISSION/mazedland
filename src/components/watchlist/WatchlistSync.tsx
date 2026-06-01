"use client";

import { useEffect } from "react";
import { ensureWatchlistHydrated } from "@/lib/watchlistStore";

/**
 * Kicks off the one-per-load watchlist+auth fetch after hydration. Mounted
 * once in the locale layout so every page (especially the static home page)
 * gets accurate saved-hearts and login state without the server having to
 * read cookies. Renders nothing.
 */
export function WatchlistSync() {
  useEffect(() => {
    ensureWatchlistHydrated();
  }, []);
  return null;
}
