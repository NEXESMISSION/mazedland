import type { Auction, Bid } from "./types";
import { minBidIncrement } from "./utils";

/**
 * Compute the minimum acceptable next bid for an auction. Combines the
 * current price with the increment ladder (plan §8). Returns the
 * opening price for an auction that has no bids yet.
 */
export function nextMinBid(auction: Auction, currentBid?: number | null): number {
  const base = currentBid ?? auction.current_price ?? auction.opening_price;
  if (!auction.current_price && (currentBid ?? 0) === 0) return auction.opening_price;
  return base + minBidIncrement(base);
}

/**
 * Anti-sniping: when a bid lands inside the configured window before
 * `ends_at`, push `ends_at` forward by `extend_by_seconds`. Defaults match
 * the plan: 5 min trigger, 10 min extension. Returns the new end time
 * or `null` if no extension is needed.
 */
export function nextEndsAtAfterBid(
  auction: Auction,
  bidAt: Date,
): Date | null {
  const endsAt = new Date(auction.ends_at);
  const triggerStart = new Date(endsAt.getTime() - auction.extend_window_seconds * 1000);
  if (bidAt < triggerStart) return null;
  return new Date(endsAt.getTime() + auction.extend_by_seconds * 1000);
}

/**
 * Proxy bidding resolution. Given the existing live max-bids and a new
 * incoming bid, returns the winning bid and the resulting visible price.
 *
 * The rule (eBay-style): the highest-max wins, and the visible price
 * settles at one increment above the second-highest max (or at the
 * incoming amount, whichever is higher), capped at the winner's max.
 *
 * Used both as a planner before persisting and as the authoritative
 * resolver in the bid-placement RPC.
 */
export function resolveProxyBid({
  existingMaxBids,
  incomingBidderId,
  incomingMaxAmount,
  openingPrice,
}: {
  existingMaxBids: { bidder_id: string; max_amount: number }[];
  incomingBidderId: string;
  incomingMaxAmount: number;
  openingPrice: number;
}): { winningBidderId: string; visibleAmount: number } {
  // Top max across all bidders (existing + incoming, dropping any prior
  // max from the same incoming bidder so they can lift their own ceiling).
  const filtered = existingMaxBids.filter((b) => b.bidder_id !== incomingBidderId);
  const all = [
    ...filtered,
    { bidder_id: incomingBidderId, max_amount: incomingMaxAmount },
  ].sort((a, b) => b.max_amount - a.max_amount);

  const winner = all[0];
  const runnerUp = all[1];

  if (!runnerUp) {
    // First bidder ever — visible price is the opening, which is the floor.
    return { winningBidderId: winner.bidder_id, visibleAmount: openingPrice };
  }

  // Visible price = runnerUp + one increment, clamped to winner's ceiling.
  const stepped = runnerUp.max_amount + minBidIncrement(runnerUp.max_amount);
  const visible = Math.min(stepped, winner.max_amount);
  return { winningBidderId: winner.bidder_id, visibleAmount: visible };
}

/**
 * Dutch auction price ticker. Given the auction config and the elapsed
 * time, returns the current asked price. Stops at the floor (which is
 * the plan's reserve / opening price).
 */
export function dutchCurrentPrice(auction: Auction, now: Date = new Date()): number {
  if (auction.type !== "dutch") {
    throw new Error("dutchCurrentPrice called on non-dutch auction");
  }
  const start = auction.dutch_start_price ?? auction.opening_price;
  const floor = auction.dutch_floor_price ?? auction.opening_price;
  const decrement = auction.dutch_decrement ?? 0;
  const tick = auction.dutch_tick_seconds ?? 60;
  const startedAt = new Date(auction.starts_at).getTime();
  const elapsedSec = Math.max(0, (now.getTime() - startedAt) / 1000);
  const ticks = Math.floor(elapsedSec / tick);
  const dropped = start - ticks * decrement;
  return Math.max(floor, dropped);
}

/**
 * Sixth-offer rule (offre du sixième). Per the Tunisian rules baked into
 * the plan §5, a higher offer is admissible during the 8-day window only
 * if it exceeds the winning amount by at least 1/6 (16.67%). Returns the
 * minimum admissible amount.
 */
export function minSixthOffer(winningAmount: number): number {
  return Math.ceil(winningAmount * (7 / 6));
}

/**
 * Pure helper used by the live UI to display "ends in HH:MM:SS" without
 * forcing every component to recompute the math. Returns negative seconds
 * once the auction has technically ended.
 */
export function secondsRemaining(endsAtIso: string, now: Date = new Date()): number {
  return Math.floor((new Date(endsAtIso).getTime() - now.getTime()) / 1000);
}

/**
 * Build a sane sorted list of bids for display. Highest first, with
 * proxy bids deduplicated to one row per bidder (their current visible
 * stand-in), so the bid history doesn't show spammy auto-increments.
 */
export function bidHistoryForDisplay(bids: Bid[]): Bid[] {
  const seen = new Set<string>();
  const out: Bid[] = [];
  for (const b of [...bids].sort(
    (a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime(),
  )) {
    if (b.is_proxy && seen.has(b.bidder_id)) continue;
    seen.add(b.bidder_id);
    out.push(b);
  }
  return out;
}
