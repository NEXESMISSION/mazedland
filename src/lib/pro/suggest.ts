/**
 * A shop answering a demande (P3): it sees what buyers and tenants are looking
 * for — never who they are — and may put one of its annonces in front of
 * them. Pure: which of the shop's annonces fit a demande, best first.
 */
import { matchRequest, type MatchableListing, type MatchableRequest, type MatchResult } from "@/lib/requests/model";

/** A demande hears from one shop three times at most. */
export const MAX_SUGGESTIONS_PER_REQUEST = 3;
/** And a shop proposes thirty annonces a day at most, across all demandes. */
export const MAX_SUGGESTIONS_PER_DAY = 30;

export type Ranked<L> = { listing: L; match: MatchResult };

/**
 * The shop's annonces for this demande: only the same offer (a tenant is
 * never shown a sale), those meeting every condition first, then by score.
 */
export function rankForRequest<L extends MatchableListing>(listings: L[], request: MatchableRequest): Ranked<L>[] {
  return listings
    .map((listing) => ({ listing, match: matchRequest(listing, request) }))
    .filter((r) => !r.match.failed.includes("deal"))
    .sort((a, b) => Number(b.match.ok) - Number(a.match.ok) || b.match.score - a.match.score);
}
