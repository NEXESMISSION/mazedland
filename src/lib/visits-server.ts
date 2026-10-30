/**
 * Visit requests on the server (0174): who is asking about one, and the
 * client card a shop gets with it. Service role; callers have checked the
 * session.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { can, roleIn } from "@/lib/pro/shops";
import { stageAfterVisit, type LeadStage, type VisitSide, type VisitSlot, type VisitStatus } from "@/lib/visits";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const VISIT_COLUMNS =
  "id, listing_id, buyer_id, seller_id, shop_id, slots, buyer_name, buyer_phone, message, status, confirmed_slot, seller_note, decided_at, created_at";

export type VisitRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  shop_id: string | null;
  slots: VisitSlot[];
  buyer_name: string;
  buyer_phone: string | null;
  message: string | null;
  status: VisitStatus;
  confirmed_slot: VisitSlot | null;
  seller_note: string | null;
  decided_at: string | null;
  created_at: string;
};

/**
 * Which side of a visit this person is on. The seller's side is the person
 * who listed it, and, for a shop's annonce, anyone on the shop's team.
 */
export async function visitSide(admin: Admin, v: Pick<VisitRow, "seller_id" | "buyer_id" | "shop_id">, userId: string): Promise<VisitSide | null> {
  if (v.seller_id === userId) return "seller";
  if (v.shop_id && can(await roleIn(admin, v.shop_id, userId), "clients")) return "seller";
  if (v.buyer_id === userId) return "buyer";
  return null;
}

/**
 * A visit on a shop's annonce puts its buyer in the shop's clients: the open
 * card for this buyer and annonce if there is one, a new one otherwise.
 */
export async function leadForVisit(admin: Admin, v: VisitRow): Promise<void> {
  if (!v.shop_id) return;
  const { data: open } = await admin
    .from("leads")
    .select("id")
    .eq("shop_id", v.shop_id)
    .eq("buyer_id", v.buyer_id)
    .eq("listing_id", v.listing_id)
    .not("stage", "in", "(won,lost)")
    .limit(1)
    .maybeSingle();
  if (open) {
    await admin.from("leads").update({ visit_id: v.id, phone: v.buyer_phone }).eq("id", open.id);
    return;
  }
  await admin.from("leads").insert({
    shop_id: v.shop_id,
    listing_id: v.listing_id,
    buyer_id: v.buyer_id,
    visit_id: v.id,
    name: v.buyer_name,
    phone: v.buyer_phone,
    source: "visit",
    stage: "new",
  });
}

/** Moves the visit's client card along when the visit is set or held. */
export async function syncLeadStage(admin: Admin, visitId: string, status: VisitStatus): Promise<void> {
  const { data: lead } = await admin.from("leads").select("id, stage").eq("visit_id", visitId).maybeSingle();
  if (!lead) return;
  const next = stageAfterVisit(lead.stage as LeadStage, status);
  if (next !== lead.stage) await admin.from("leads").update({ stage: next }).eq("id", lead.id);
}

export type VisitView = VisitRow & { listing: { id: string; title: string; photo: string | null } | null };

/** Visits with their annonce's title and first photo, newest first. */
export async function loadVisits(
  admin: Admin,
  by: { seller?: string; buyer?: string; shop?: string },
  limit = 100,
): Promise<VisitView[]> {
  let q = admin
    .from("visit_requests")
    .select(`${VISIT_COLUMNS}, listing:listings!visit_requests_listing_id_fkey (id, title, photos:listing_photos (storage_path, sort_order))`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (by.seller) q = q.eq("seller_id", by.seller);
  if (by.buyer) q = q.eq("buyer_id", by.buyer);
  if (by.shop) q = q.eq("shop_id", by.shop);
  const { data } = await q;
  type Raw = VisitRow & {
    listing:
      | { id: string; title: string; photos: { storage_path: string; sort_order: number }[] | null }
      | { id: string; title: string; photos: { storage_path: string; sort_order: number }[] | null }[]
      | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((v) => {
    const l = Array.isArray(v.listing) ? v.listing[0] : v.listing;
    const photo = l?.photos?.slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path ?? null;
    return { ...v, listing: l ? { id: l.id, title: l.title, photo } : null };
  });
}
