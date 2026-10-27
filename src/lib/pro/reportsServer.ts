import type { SupabaseClient } from "@supabase/supabase-js";
import { tunisDay } from "@/lib/visits";
import { addDays, buildReport, periodDays, type RawReport, type ReportListing, type ReportPeriod, type ShopReport } from "./reports";

/**
 * Loads an agence's report for the last `days` Tunis days (and the period
 * before, for the comparison). `sellerId` narrows it to one member's annonces:
 * an agent sees their own, the owner and the admins see the agence's.
 * Read with the service role; the caller checked the membership.
 */
export async function loadShopReport(
  admin: SupabaseClient,
  opts: { shopId: string; days: ReportPeriod; sellerId: string | null; tracesKeptDays: number; now?: Date },
): Promise<ShopReport> {
  const today = tunisDay(opts.now ?? new Date());
  const from = periodDays(today, opts.days)[0];
  // Tunisia is UTC+1 all year: midnight there, the day the period before starts.
  const since = `${addDays(from, -opts.days)}T00:00:00+01:00`;

  let listingsQuery = admin
    .from("listings")
    .select("id, reference, title, seller_id, status")
    .eq("shop_id", opts.shopId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (opts.sellerId) listingsQuery = listingsQuery.eq("seller_id", opts.sellerId);

  const [{ data: rawData }, { data: listingRows }, { data: memberRows }] = await Promise.all([
    admin.rpc("shop_report", { p_shop: opts.shopId, p_since: since, p_seller: opts.sellerId }),
    listingsQuery,
    admin.from("shop_members").select("user_id").eq("shop_id", opts.shopId),
  ]);

  const listings: ReportListing[] = ((listingRows ?? []) as { id: string; reference: string | null; title: string; seller_id: string; status: string }[]).map(
    (l) => ({ id: l.id, reference: l.reference, title: l.title, sellerId: l.seller_id, status: l.status }),
  );

  // Members today, and whoever published an annonce of the agence before leaving it.
  const ids = Array.from(new Set([...((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id), ...listings.map((l) => l.sellerId)]));
  const { data: people } = ids.length && !opts.sellerId
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name?.trim() || "—"]));

  return buildReport({
    raw: (rawData ?? {}) as RawReport,
    days: opts.days,
    today,
    listings,
    members: opts.sellerId ? [] : ids.map((userId) => ({ userId, name: names.get(userId) ?? "—" })),
    byAgent: !opts.sellerId,
    tracesKeptDays: opts.tracesKeptDays,
  });
}
