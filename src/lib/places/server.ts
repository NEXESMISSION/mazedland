import type { getServiceSupabase } from "@/lib/supabase/admin";
import { activePlan, can, roleIn, type ActivePlan } from "@/lib/pro/shops";
import { PLACE_STATUSES, placeFor, placesLeft, roomiest, type Allowance } from "./model";

/**
 * Places, read from the database (the rules are in ./model.ts). Every count
 * here is a fresh count of annonces — there is no stored counter to drift,
 * reset with a new plan, or double on a payment accepted twice.
 *
 * Service-role reads, from routes and pages that have already checked who is
 * asking.
 */

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;
const STATUSES = PLACE_STATUSES as unknown as string[];
const NO_ID = "00000000-0000-0000-0000-000000000000";

/** The account's annonces that hold a place, agence ones included, not counting `excludeId`. */
export async function accountUsage(admin: Admin, userId: string, excludeId: string = NO_ID): Promise<number> {
  const { count } = await admin
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", userId)
    .neq("id", excludeId)
    .in("status", STATUSES);
  return count ?? 0;
}

/**
 * The places an agence's plan holds: its annonces, whoever of its members
 * published them, and its owner's own annonces — the ones from before the
 * agence and the ones published outside it. Not counting `excludeId`.
 */
export async function planUsage(admin: Admin, shopId: string, excludeId: string = NO_ID): Promise<number> {
  const { data: shop } = await admin.from("shops").select("owner_id").eq("id", shopId).maybeSingle();
  const owner = (shop?.owner_id as string | undefined) ?? null;
  const scope = owner
    ? `shop_id.eq.${shopId},and(shop_id.is.null,seller_id.eq.${owner})`
    : `shop_id.eq.${shopId}`;
  const { count } = await admin
    .from("listings")
    .select("id", { count: "exact", head: true })
    .or(scope)
    .neq("id", excludeId)
    .in("status", STATUSES);
  return count ?? 0;
}

export type OwnedPlan = { shopId: string; shopName: string; plan: ActivePlan; used: number; quota: number };

/**
 * The running plan of an approved agence this person owns — the one with
 * the most room if they own several — with its places used. Null for an
 * account on its free places.
 */
export async function ownedPlan(admin: Admin, userId: string, excludeId: string = NO_ID): Promise<OwnedPlan | null> {
  const { data } = await admin.from("shops").select("id, name").eq("owner_id", userId).eq("status", "approved");
  const shops = (data ?? []) as { id: string; name: string }[];
  const plans = (
    await Promise.all(
      shops.map(async (s) => {
        const plan = await activePlan(admin, s.id);
        if (!plan) return null;
        const used = await planUsage(admin, s.id, excludeId);
        return { shopId: s.id, shopName: s.name, plan, used, quota: plan.quota };
      }),
    )
  ).filter((p): p is OwnedPlan => p !== null);
  return roomiest(plans);
}

/**
 * What the account may still put online, as « Mes annonces » and the
 * publish form show it: its plan if it owns one, else its free places.
 */
export async function accountAllowance(admin: Admin, userId: string, freeLimit: number): Promise<Allowance> {
  const owned = await ownedPlan(admin, userId);
  if (owned) {
    return {
      kind: "plan",
      used: owned.used,
      limit: owned.quota,
      left: placesLeft(owned.used, owned.quota),
      planName: owned.plan.name,
      shopId: owned.shopId,
      shopName: owned.shopName,
    };
  }
  const used = await accountUsage(admin, userId);
  return { kind: "free", used, limit: freeLimit, left: placesLeft(used, freeLimit) };
}

/**
 * Whether this annonce can go online under its agence's plan: the agence is
 * open, the person is a member who may publish, a plan is running and it has
 * room.
 */
export async function planCovers(
  admin: Admin,
  shopId: string,
  userId: string,
  listingId: string,
): Promise<
  | { ok: true; left: number; quota: number; ownerId: string | null }
  | { ok: false; reason: "not_member" | "shop_closed" | "no_plan"; quota?: undefined }
  | { ok: false; reason: "quota_full"; quota: number }
> {
  const [{ data: shop }, role, plan] = await Promise.all([
    admin.from("shops").select("status, owner_id").eq("id", shopId).maybeSingle(),
    roleIn(admin, shopId, userId),
    activePlan(admin, shopId),
  ]);
  if (!can(role, "publish")) return { ok: false, reason: "not_member" };
  if (shop?.status !== "approved") return { ok: false, reason: "shop_closed" };
  if (!plan) return { ok: false, reason: "no_plan" };
  const used = await planUsage(admin, shopId, listingId);
  if (used >= plan.quota) return { ok: false, reason: "quota_full", quota: plan.quota };
  return { ok: true, left: plan.quota - used - 1, quota: plan.quota, ownerId: (shop.owner_id as string | null) ?? null };
}

export type Cover =
  | { via: "subscription"; left: number; shopId: string }
  | { via: "free_quota"; left: number }
  | { via: "credit"; left: number };

/**
 * How an annonce taking a place is paid for — the one decision submit,
 * renew and relist share, in this order:
 *
 *   1. an agence annonce: its agence's plan, while it has room;
 *   2. the owner of an agence with a running plan: that plan, for their own
 *      annonces too (their free places are inside it now);
 *   3. an account without such a plan: its free places;
 *   4. a pack credit (spent here — call this once, when the annonce goes).
 *
 * Null: nothing covers it, the caller answers `free_limit_reached`.
 */
export async function coverPlace(
  admin: Admin,
  { userId, listingId, shopId }: { userId: string; listingId: string; shopId: string | null },
  freeLimit: number,
): Promise<Cover | null> {
  const shopPlan = shopId ? await planCovers(admin, shopId, userId, listingId) : null;
  const owned = shopPlan?.ok ? null : await ownedPlan(admin, userId, listingId);
  const accountUsed = shopPlan?.ok || owned ? 0 : await accountUsage(admin, userId, listingId);
  const way = placeFor({
    forShop: Boolean(shopId),
    shopPlanHasRoom: Boolean(shopPlan?.ok),
    ownedPlan: owned,
    accountUsed,
    freeLimit,
  });
  if (way === "shop_plan" && shopPlan?.ok) return { via: "subscription", left: shopPlan.left, shopId: shopId! };
  if (way === "own_plan" && owned) return { via: "subscription", left: owned.quota - owned.used - 1, shopId: owned.shopId };
  if (way === "free_quota") return { via: "free_quota", left: freeLimit - accountUsed - 1 };

  const { data: credited } = await admin.rpc("consume_listing_credit", {
    p_seller: userId,
    p_listing: listingId,
    p_actor: userId,
  });
  if (credited?.ok === true) return { via: "credit", left: credited.remaining as number };
  return null;
}

export type Claim = { from: readonly string[]; to: "pending_review" | "published" };
export type Taken =
  | { ok: true; cover: Cover }
  | { ok: false; reason: "not_submittable" | "taken_down" | "free_limit_reached" }
  /** The agence's plan is full: said as such, not as « your free annonces ». */
  | { ok: false; reason: "plan_full"; limit: number };

/** The plan a place is taken under, for the count the database makes under its lock. */
type PlanLock = { shopId: string; ownerId: string | null; quota: number };

/**
 * coverPlace, with the place taken in the same breath. The count of free
 * places and the flip of the status happen in one transaction under a lock
 * (claim_listing_place, 0190): two submits sent at the same moment cannot
 * both pass the count, a double tap on « Publier » is one publication, not
 * two, and an annonce an admin took down (`taken_down_at`) is refused before
 * anything is spent. A credit is spent only once the status is held; when
 * there is none to spend, the status goes back to `fromStatus`.
 */
export async function takePlace(
  admin: Admin,
  { userId, listingId, shopId, fromStatus }: { userId: string; listingId: string; shopId: string | null; fromStatus: string },
  freeLimit: number,
  claim: Claim,
): Promise<Taken> {
  const flip = async (limit: number | null, plan: PlanLock | null = null) => {
    const { data, error } = await admin.rpc("claim_listing_place", {
      p_listing: listingId,
      p_seller: userId,
      p_from: [...claim.from],
      p_to: claim.to,
      p_limit: limit,
      p_shop: plan?.shopId ?? null,
      p_shop_owner: plan?.ownerId ?? null,
      p_shop_limit: plan?.quota ?? null,
    });
    if (error) throw error;
    return data as "ok" | "not_submittable" | "taken_down" | "full";
  };
  const deny = (r: "not_submittable" | "taken_down" | "full", plan: PlanLock | null = null): Taken =>
    r === "full"
      ? plan
        ? { ok: false, reason: "plan_full", limit: plan.quota }
        : { ok: false, reason: "free_limit_reached" }
      : { ok: false, reason: r };

  const shopPlan = shopId ? await planCovers(admin, shopId, userId, listingId) : null;
  const owned = shopPlan?.ok ? null : await ownedPlan(admin, userId, listingId);
  const accountUsed = shopPlan?.ok || owned ? 0 : await accountUsage(admin, userId, listingId);
  const way = placeFor({
    forShop: Boolean(shopId),
    shopPlanHasRoom: Boolean(shopPlan?.ok),
    ownedPlan: owned,
    accountUsed,
    freeLimit,
  });

  // A plan's places are counted again by the database, under a lock on the
  // agence: N submits at once by its members used to all pass the count made
  // here. An agence annonce whose plan is full stops here too — it does not
  // fall back to the owner's free places, which the plan contains.
  if (way === "shop_plan" && shopPlan?.ok) {
    const plan = { shopId: shopId!, ownerId: shopPlan.ownerId, quota: shopPlan.quota };
    const r = await flip(null, plan);
    return r === "ok" ? { ok: true, cover: { via: "subscription", left: shopPlan.left, shopId: shopId! } } : deny(r, plan);
  }
  if (shopId && shopPlan && !shopPlan.ok && shopPlan.reason === "quota_full") {
    return { ok: false, reason: "plan_full", limit: shopPlan.quota };
  }
  if (way === "own_plan" && owned) {
    const plan = { shopId: owned.shopId, ownerId: userId, quota: owned.quota };
    const r = await flip(null, plan);
    return r === "ok"
      ? { ok: true, cover: { via: "subscription", left: owned.quota - owned.used - 1, shopId: owned.shopId } }
      : deny(r, plan);
  }
  if (way === "free_quota") {
    const r = await flip(freeLimit);
    if (r === "ok") return { ok: true, cover: { via: "free_quota", left: freeLimit - accountUsed - 1 } };
    if (r !== "full") return deny(r);
    // A place went to another annonce between the count and the lock: a
    // credit, if the seller holds one.
  }

  // A credit — the status first, so a double tap cannot spend two.
  const r = await flip(null);
  if (r !== "ok") return deny(r);
  const { data: credited } = await admin.rpc("consume_listing_credit", {
    p_seller: userId,
    p_listing: listingId,
    p_actor: userId,
  });
  if (credited?.ok === true) return { ok: true, cover: { via: "credit", left: credited.remaining as number } };
  await admin.from("listings").update({ status: fromStatus }).eq("id", listingId).eq("status", claim.to);
  // An owner whose plan is full is told about the plan, not the free places.
  if (owned && !shopId) return { ok: false, reason: "plan_full", limit: owned.quota };
  return { ok: false, reason: "free_limit_reached" };
}
