import type { getServiceSupabase } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * An admin's takedown of an annonce (0190): archived, and recorded as taken
 * down so the seller's « Remettre en ligne » and « Renouveler » refuse while
 * it stands. The seller is told — with the reason, when the moderator gives
 * one. The single « Archiver » and the bulk one both come through here: one
 * click on a selection used to retire twenty annonces in silence, with no
 * reason kept, and the seller found out when the relist was refused.
 */
export async function takeDownListing(
  admin: Admin,
  listing: { id: string; seller_id: string; title: string },
  opts: { adminId: string; reason?: string },
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const reason = (opts.reason ?? "").trim().slice(0, 500);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("listings")
    .update({
      status: "archived",
      reviewed_by: opts.adminId,
      reviewed_at: now,
      taken_down_at: now,
      taken_down_by: opts.adminId,
      taken_down_reason: reason || null,
    })
    .eq("id", listing.id);
  if (error) return { ok: false, error };

  await admin
    .rpc("enqueue_notification", {
      p_user_id: listing.seller_id,
      p_kind: "listing_archived",
      p_title: "Annonce retirée",
      p_body: reason
        ? `« ${listing.title} » a été retirée par l'équipe Mazed Immo. Motif : ${reason}`
        : `« ${listing.title} » a été retirée par l'équipe Mazed Immo. Contactez-nous pour en savoir plus.`,
      p_link: "/account/listings",
      p_payload: { vars: { title: listing.title, variant: reason ? "withReason" : "plain", ...(reason ? { reason } : {}) } },
    })
    .then(() => {}, () => {});
  return { ok: true };
}
