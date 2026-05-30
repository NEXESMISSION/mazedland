import type { AuctionWithProperty } from "@/lib/types";
import { ExploreGrid, type ExtraFilters } from "./ExploreGrid";
import type { ExploreFilter } from "./types";

/**
 * Wrapper for the explore surface. Previously toggled between a grid and a
 * TikTok-style "reels" feed; the reel view was removed, so this now always
 * renders the grid. Kept as a thin pass-through so the page import is stable.
 */
export function ExploreView(props: {
  initialItems: AuctionWithProperty[];
  initialFilter: ExploreFilter;
  initialPage?: number;
  initialTotalPages?: number;
  initialTotalCount?: number;
  loggedIn: boolean;
  savedAuctionIds: string[];
  initialExtra?: ExtraFilters;
  initialSearch?: string;
}) {
  return <ExploreGrid {...props} />;
}
