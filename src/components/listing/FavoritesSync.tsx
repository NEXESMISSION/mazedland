"use client";

import { useEffect } from "react";
import { ensureWatchlistHydrated } from "@/lib/watchlistStore";

/**
 * Kicks off the one-per-load favourites + auth fetch after hydration.
 *
 * Mounted once in the locale layout so every page — especially the statically
 * rendered home page, which the server renders without cookies — gets accurate
 * hearts and login state. Renders nothing.
 *
 * This was `WatchlistSync`, and it hydrated saved AUCTION ids. `/api/watchlist`
 * now returns saved LISTING ids; the store underneath never cared what the ids
 * pointed at, only that they were a set.
 */
export function FavoritesSync() {
  useEffect(() => {
    ensureWatchlistHydrated();
  }, []);
  return null;
}
