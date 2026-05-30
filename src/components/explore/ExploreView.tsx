"use client";

import { useState } from "react";
import { ExploreGrid } from "./ExploreGrid";
import type { ExploreFilter } from "./types";

/**
 * Client wrapper for the explore surface. Previously toggled between a grid
 * and a TikTok-style "reels" feed; the reel view was removed, so this now
 * always renders the grid.
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
  initialSearch,
}: {
  initialItems: ExploreItem[];
  initialFilter: ExploreFilter;
  initialPage: number;
  initialTotalPages: number;
  initialTotalCount: number;
  loggedIn: boolean;
  savedAuctionIds: string[];
  initialExtra: ExtraFilters;
  initialSearch: string;
}) {
  const [items] = useState(initialItems);

  return (
    <ExploreGrid
      initialItems={items}
      initialFilter={initialFilter}
      initialPage={initialPage}
      initialTotalPages={initialTotalPages}
      initialTotalCount={initialTotalCount}
      loggedIn={loggedIn}
      savedAuctionIds={savedAuctionIds}
      initialExtra={initialExtra}
      initialSearch={initialSearch}
    />
  );
}
