"use client";

/**
 * Module-level client store for the signed-in user's watchlist + auth state.
 *
 * Why: the home page is now statically rendered (served from the edge CDN for
 * a ~20ms TTFB), which means the server can't know who you are or what you've
 * saved at request time. So PropertyCards render with `loggedIn=false` /
 * `saved=false`, and this store fills in the truth on the client right after
 * hydration — one `/api/watchlist` fetch per page load, shared by every
 * WatchlistButton via subscription (no React context/provider needed, same
 * pattern as sharedTick).
 *
 * Dynamic pages (e.g. /properties) still pass real server props; once the
 * store hydrates it simply confirms the same values, so behaviour is
 * unchanged there.
 */

export type WatchlistState = {
  hydrated: boolean;
  loggedIn: boolean;
  ids: Set<string>;
};

// Stable initial reference — returned as both the client and server snapshot
// before hydration, so useSyncExternalStore-style consumers don't loop.
let state: WatchlistState = { hydrated: false, loggedIn: false, ids: new Set() };

const subscribers = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const fn of Array.from(subscribers)) {
    try {
      fn();
    } catch {
      /* a misbehaving subscriber must not break the others */
    }
  }
}

export function getWatchlistState(): WatchlistState {
  return state;
}

export function subscribeWatchlist(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Fetch the user's saved auction ids + login state exactly once per page
 * load. No-ops on the server, if already hydrated, or while a fetch is in
 * flight. Off the critical path — called from an effect after first paint.
 */
export function ensureWatchlistHydrated(): void {
  if (state.hydrated || inflight || typeof window === "undefined") return;
  inflight = fetch("/api/watchlist", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { loggedIn: false, ids: [] }))
    .then((d: { loggedIn?: boolean; ids?: string[] }) => {
      state = {
        hydrated: true,
        loggedIn: Boolean(d.loggedIn),
        ids: new Set(d.ids ?? []),
      };
      emit();
    })
    .catch(() => {
      // Network error → mark hydrated so we stop retrying this load; the
      // hearts simply stay in their server-rendered state.
      state = { ...state, hydrated: true };
      emit();
    })
    .finally(() => {
      inflight = null;
    });
}

/**
 * Optimistic local toggle so every heart for the same auction (it can appear
 * in several rails) flips together and survives a remount. The network call
 * is fired by the button; on failure it calls this again to revert.
 */
export function setWatchlistLocal(auctionId: string, saved: boolean): void {
  const ids = new Set(state.ids);
  if (saved) ids.add(auctionId);
  else ids.delete(auctionId);
  state = { ...state, ids };
  emit();
}
