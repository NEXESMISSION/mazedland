/**
 * Places: how many annonces an account may keep online, and how many it does.
 *
 * One rule for every screen and every route (« Mes annonces », the publish
 * form, the agence dashboard, the console, submit / renew / relist):
 *
 *   - What holds a place: an annonce online or waiting for a moderator.
 *     Drafts, withdrawn (archived), expired, refused, sold, rented and
 *     deleted annonces do not.
 *   - An account is on one allowance at a time. Its free places, or — once it
 *     owns an agence with a running plan — that plan. Upgrading moves the
 *     account up; it does not open a second, empty count beside the first:
 *     the owner's own annonces, published before the agence existed or
 *     outside it, are counted in the plan with the agence's. Two annonces
 *     then a plan of ten reads « 2 / 10 », and eight more go online.
 *   - Counts are read from the annonces themselves every time, never kept in
 *     a counter, so a plan change, a refresh, a new login or a payment
 *     accepted twice cannot reset them.
 *
 * The database side is src/lib/places/server.ts.
 */

/** The statuses that hold a place. */
export const PLACE_STATUSES = ["published", "pending_review"] as const;

export function holdsPlace(status: string | null | undefined): boolean {
  return (PLACE_STATUSES as readonly string[]).includes(status ?? "");
}

export type Allowance =
  | { kind: "free"; used: number; limit: number; left: number }
  | {
      kind: "plan";
      used: number;
      limit: number;
      left: number;
      planName: string;
      shopId: string;
      shopName: string;
    };

/** Places left; never negative, even for an account over its limit. */
export function placesLeft(used: number, limit: number): number {
  return Math.max(0, limit - used);
}

/**
 * Which allowance covers one more annonce, before any credit is spent:
 *
 *   1. an agence annonce whose agence's plan has room → that plan;
 *   2. an owner's own annonce, while their plan has room → their plan;
 *   3. an account that owns no running plan, under its free places → free;
 *   4. otherwise a pack credit, if the seller holds one (the caller spends it).
 *
 * An owner with a plan never falls back on free places: those are inside the
 * plan now, and counting them again would put the account over its plan.
 */
export function placeFor(input: {
  /** The annonce is published for an agence. */
  forShop: boolean;
  /** That agence's plan has room for this one (planCovers). */
  shopPlanHasRoom: boolean;
  /** The plan of the agence the seller owns, if one is running. */
  ownedPlan: { used: number; quota: number } | null;
  /** The seller's annonces holding a place, this one not counted. */
  accountUsed: number;
  freeLimit: number;
}): "shop_plan" | "own_plan" | "free_quota" | "credit" {
  if (input.forShop && input.shopPlanHasRoom) return "shop_plan";
  if (input.ownedPlan) {
    return !input.forShop && input.ownedPlan.used < input.ownedPlan.quota ? "own_plan" : "credit";
  }
  return input.accountUsed < input.freeLimit ? "free_quota" : "credit";
}

/**
 * The plan an owner publishes under when they own several: the one with the
 * most room left, so a full agence does not hide another with space.
 */
export function roomiest<T extends { used: number; quota: number }>(plans: T[]): T | null {
  let best: T | null = null;
  for (const p of plans) {
    if (!best || placesLeft(p.used, p.quota) > placesLeft(best.used, best.quota)) best = p;
  }
  return best;
}
