import type { getServiceSupabase } from "@/lib/supabase/admin";
import { asDealType, type Furnished } from "@/lib/listings/deal";
import { matchRequest, type MatchableListing, type MatchableRequest } from "./model";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

type RequestRow = {
  id: string;
  user_id: string;
  deal_type: string;
  category_ids: string[] | null;
  governorates: string[] | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  surface_min: number | string | null;
  rooms_min: number | null;
  furnished: string | null;
  move_in_by: string | null;
};

const n = (v: number | string | null) => (v == null ? null : Number(v));

/** A row as the pure matcher reads it (numerics arrive as strings). */
export function toMatchable(r: Omit<RequestRow, "id" | "user_id">): MatchableRequest {
  return {
    deal_type: asDealType(r.deal_type),
    category_ids: r.category_ids ?? [],
    governorates: r.governorates ?? [],
    budget_min: n(r.budget_min),
    budget_max: n(r.budget_max),
    surface_min: n(r.surface_min),
    rooms_min: r.rooms_min,
    furnished: (r.furnished as Furnished | null) ?? null,
    move_in_by: r.move_in_by,
  };
}

/**
 * Tell the people whose demande a freshly published annonce answers (0168).
 *
 * Runs after `publishListing`, on every path that puts an annonce online. A
 * match is recorded once per (demande, annonce), so a renewal or a relist does
 * not send it again; a person with several matching demandes gets one
 * notification. The seller is never told about their own annonce. Never
 * throws: a failed alert must not undo a publication.
 */
export async function notifyMatchingRequests(admin: Admin, listingId: string): Promise<number> {
  try {
    const { data: l } = await admin
      .from("listings")
      .select(
        "id, seller_id, title, deal_type, category_id, governorate, price, price_on_request, attributes, furnished, available_from",
      )
      .eq("id", listingId)
      .maybeSingle();
    if (!l) return 0;

    const { data: rows } = await admin
      .from("property_requests")
      .select(
        "id, user_id, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, move_in_by",
      )
      .eq("status", "active")
      .eq("alerts", true)
      .eq("deal_type", asDealType(l.deal_type))
      .gt("expires_at", new Date().toISOString())
      .neq("user_id", l.seller_id as string)
      .limit(1000);

    const listing = l as unknown as MatchableListing & { id: string; title: string };
    const hits = ((rows ?? []) as RequestRow[])
      .map((r) => ({ r, m: matchRequest(listing, toMatchable(r)) }))
      .filter((x) => x.m.ok);
    if (hits.length === 0) return 0;

    // Only the rows that are new: ignoreDuplicates returns what it inserted.
    const { data: inserted } = await admin
      .from("matches")
      .upsert(
        hits.map(({ r, m }) => ({
          request_id: r.id,
          listing_id: listing.id,
          score: m.score,
          reasons: { met: m.met, unknown: m.unknown },
        })),
        { onConflict: "request_id,listing_id", ignoreDuplicates: true },
      )
      .select("request_id");
    const fresh = new Set(((inserted ?? []) as { request_id: string }[]).map((x) => x.request_id));
    const users = [...new Set(hits.filter((h) => fresh.has(h.r.id)).map((h) => h.r.user_id))];

    for (const userId of users) {
      await admin
        .rpc("enqueue_notification", {
          p_user_id: userId,
          p_kind: "request_match",
          p_title: "Un bien correspond à votre demande",
          p_body: `« ${listing.title} » vient d'être publié et correspond à votre demande.`,
          p_link: `/annonces/${listing.id}`,
          p_payload: { vars: { title: listing.title } },
        })
        .then(() => {}, () => {});
    }
    return users.length;
  } catch {
    return 0;
  }
}
