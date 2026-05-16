"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

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
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  function onClick(e: React.MouseEvent) {
    // Card-level <Link> wraps the heart; stop the click from triggering
    // the navigation when the heart is the actual target.
    e.preventDefault();
    e.stopPropagation();

    if (!loggedIn) {
      const here = typeof window !== "undefined" ? window.location.pathname : "/";
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }

    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const res = await fetch(`/api/watchlist/${auctionId}`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        // Revert. Don't bother surfacing — the heart is fire-and-forget UX.
        setSaved(!next);
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
