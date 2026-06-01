"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Heart } from "lucide-react";
import {
  ensureWatchlistHydrated,
  getWatchlistState,
  subscribeWatchlist,
  setWatchlistLocal,
} from "@/lib/watchlistStore";

/**
 * Toggle watchlist membership for a single auction. Optimistic — flips
 * the heart instantly, reverts on error. Anonymous users tapping it
 * get bounced to /login with a return URL back to where they were.
 */
export function WatchlistButton({
  auctionId,
  initialSaved,
  loggedIn,
  size = "md",
}: {
  auctionId: string;
  initialSaved: boolean;
  loggedIn: boolean;
  size?: "sm" | "md";
}) {
  const t = useTranslations("watchlistApi");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Subscribe to the shared client store. Before it hydrates we fall back to
  // the server-rendered props (correct on dynamic pages; "logged out / not
  // saved" on the static home page until the fetch lands a moment later).
  const [store, setStore] = useState(() => getWatchlistState());
  useEffect(() => {
    ensureWatchlistHydrated();
    return subscribeWatchlist(() => setStore(getWatchlistState()));
  }, []);

  const effectiveLoggedIn = store.hydrated ? store.loggedIn : loggedIn;
  const saved = store.hydrated ? store.ids.has(auctionId) : initialSaved;

  function onClick(e: React.MouseEvent) {
    // Card-level <Link> wraps the heart; stop the click from triggering
    // the navigation when the heart is the actual target.
    e.preventDefault();
    e.stopPropagation();

    if (!effectiveLoggedIn) {
      // window.location.pathname includes the `/fr` locale prefix.
      // LoginForm's safeNextPath + stripLocalePrefix together strip
      // it back off before the post-login redirect, so we can pass
      // the full visible URL here.
      const here = typeof window !== "undefined" ? window.location.pathname : "/";
      router.push(`/login?next=${encodeURIComponent(here)}` as never);
      return;
    }

    const next = !saved;
    // Optimistic: update the shared store so every heart for this auction
    // (it can appear in several rails) flips together.
    setWatchlistLocal(auctionId, next);
    startTransition(async () => {
      const res = await fetch(`/api/watchlist/${auctionId}`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        // Revert. Don't bother surfacing — the heart is fire-and-forget UX.
        setWatchlistLocal(auctionId, !next);
      }
    });
  }

  const sizeClass = size === "sm" ? "size-8" : "size-10";
  const iconClass = size === "sm" ? "size-4" : "size-5";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? t("saved") : t("save")}
      className={`tap-target inline-flex ${sizeClass} items-center justify-center rounded-full backdrop-blur-md transition active:scale-90 ${
        saved
          ? "bg-red-500 text-white shadow-md shadow-red-500/30"
          : "bg-batta-surface/85 text-batta-cream/85 ring-1 ring-batta-gold/30"
      }`}
    >
      <Heart className={`${iconClass} ${saved ? "fill-current" : ""}`} />
    </button>
  );
}
