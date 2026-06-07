"use client";

/**
 * Module-level client store for the set of auctions the signed-in user has an
 * ACTIVE caution on (cleared to bid). Same rationale + shape as
 * watchlistStore: the home page is statically rendered, so the server can't
 * know who you are at request time. Cards render without the "Enchérir"
 * shortcut, and this store fills in the truth right after hydration — one
 * `/api/my-deposits` fetch per page load, shared by every StartBiddingButton
 * via subscription (no React context/provider needed).
 */

export type DepositState = {
  hydrated: boolean;
  loggedIn: boolean;
  ids: Set<string>;
};

// Stable initial reference — returned as both client and server snapshot
// before hydration so useSyncExternalStore consumers don't loop.
let state: DepositState = { hydrated: false, loggedIn: false, ids: new Set() };

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

export function getDepositState(): DepositState {
  return state;
}

export function subscribeDeposits(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Fetch the user's active-deposit auction ids exactly once per page load.
 * No-ops on the server, if already hydrated, or while a fetch is in flight.
 * Off the critical path — called from an effect after first paint.
 */
export function ensureDepositsHydrated(): void {
  if (state.hydrated || inflight || typeof window === "undefined") return;
  inflight = fetch("/api/my-deposits", { cache: "no-store", signal: AbortSignal.timeout(10000) })
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
      state = { ...state, hydrated: true };
      emit();
    })
    .finally(() => {
      inflight = null;
    });
}
