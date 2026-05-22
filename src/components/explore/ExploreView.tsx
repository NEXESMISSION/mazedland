"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Film } from "lucide-react";
import type { AuctionWithProperty } from "@/lib/types";
import { ExploreFeed, type ExploreFilter } from "./ExploreFeed";
import { ExploreGrid, type ExtraFilters } from "./ExploreGrid";

type ViewMode = "grid" | "reels";
const STORAGE_KEY = "batta_explore_view";

/**
 * Parent that decides which Explore mode to render: the classic
 * scannable grid or the TikTok-style vertical reels feed. Choice is
 * persisted in localStorage so a user who picks "reels" once keeps
 * landing on it. Default is "grid" — the familiar, easy-to-scan
 * catalogue layout.
 *
 * Both children take the same `initial*` props, so switching modes
 * starts fresh from the server snapshot (no shared filter state). That
 * keeps each view simple at the cost of one fetch on mode switch —
 * an acceptable trade for the user's familiar control over each view.
 */
export function ExploreView({
  initialItems,
  initialFilter,
  initialPage,
  initialTotalPages,
  initialTotalCount,
  loggedIn,
  savedAuctionIds,
  initialExtra,
}: {
  initialItems: AuctionWithProperty[];
  initialFilter: ExploreFilter;
  initialPage?: number;
  initialTotalPages?: number;
  initialTotalCount?: number;
  loggedIn: boolean;
  savedAuctionIds: string[];
  initialExtra?: ExtraFilters;
}) {
  // Default to grid on first render (server + first paint) to avoid a
  // layout flicker on hydration. The effect below upgrades to "reels"
  // if that's what the user picked previously.
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "reels" || stored === "grid") setView(stored);
    } catch {
      /* localStorage blocked — fall back to default */
    }
  }, []);

  const onChange = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  if (view === "reels") {
    return (
      <ExploreFeed
        initialItems={initialItems}
        loggedIn={loggedIn}
        savedAuctionIds={savedAuctionIds}
        viewToggle={<ViewToggle value={view} onChange={onChange} dark />}
      />
    );
  }

  return (
    <ExploreGrid
      initialItems={initialItems}
      initialFilter={initialFilter}
      initialPage={initialPage}
      initialTotalPages={initialTotalPages}
      initialTotalCount={initialTotalCount}
      loggedIn={loggedIn}
      savedAuctionIds={savedAuctionIds}
      viewToggle={<ViewToggle value={view} onChange={onChange} />}
      initialExtra={initialExtra}
    />
  );
}

// ─── View toggle pill ─────────────────────────────────────────────────

function ViewToggle({
  value,
  onChange,
  dark = false,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  dark?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Mode d'affichage"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border p-0.5 ${
        dark
          ? "border-white/15 bg-black/40 backdrop-blur-md"
          : "border-[var(--border)] bg-white shadow-sm"
      }`}
    >
      <ToggleButton
        active={value === "grid"}
        onClick={() => onChange("grid")}
        label="Grille"
        ariaLabel="Vue grille"
        dark={dark}
      >
        <LayoutGrid className="size-4" strokeWidth={2.2} />
      </ToggleButton>
      <ToggleButton
        active={value === "reels"}
        onClick={() => onChange("reels")}
        label="Reels"
        ariaLabel="Vue Reels (TikTok)"
        dark={dark}
      >
        <Film className="size-4" strokeWidth={2.2} />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  ariaLabel,
  children,
  dark,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  ariaLabel: string;
  dark: boolean;
  children: React.ReactNode;
}) {
  // Two visual modes:
  //  - dark (when the surrounding view is reels): gold-fill when active,
  //    transparent white otherwise — matches the in-feed filter rail
  //  - light (grid view): gold-fill when active, muted ink otherwise
  if (dark) {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={ariaLabel}
        onClick={onClick}
        className={`inline-flex h-8 w-9 items-center justify-center rounded-full text-[12px] transition-all ${
          active
            ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
            : "text-white/75 hover:bg-white/10"
        }`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex h-8 w-9 items-center justify-center rounded-full text-[12px] transition-all ${
        active
          ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
          : "text-[var(--foreground-muted)] hover:bg-[var(--gold-faint)] hover:text-[var(--gold)]"
      }`}
    >
      {children}
    </button>
  );
}
