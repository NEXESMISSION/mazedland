import type { getServiceSupabase } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * An admin's takedown of an annonce (0190), from the single action and from
 * the bulk one, so both leave the same marks and tell the seller the same
 * thing: the status, who took it down and why, and a notification with the
 * reason when the moderator gave one. While `taken_down_at` is set the
 * seller's « Remettre en ligne » and « Renouveler » refuse, so a seller left
 * in the dark had an annonce vanish with no way back and no word — which is
 * what the bulk path did.
 *
 * The write is guarded by `taken_down_at is null` in the same statement: a
 * second takedown (two moderators, a double click) changes nothing and the
 * seller is told once. It comes back as `already`.
 */
export async function takeDownListing(
  admin: Admin,
  listing: { id: string; seller_id: string; title: string },
  opts: { byId: string; reason: string | null },
): Promise<{ ok: true } | { ok: false; already: boolean; error: unknown }> {
  const now = new Date().toISOString();
  const reason = opts.reason?.trim() || null;
  const { data: moved, error } = await admin
    .from("listings")
    .update({
      status: "archived",
      reviewed_by: opts.byId,
      reviewed_at: now,
      taken_down_at: now,
      taken_down_by: opts.byId,
      taken_down_reason: reason,
    })
    .eq("id", listing.id)
    .is("taken_down_at", null)
    .select("id");
  if (error) return { ok: false, already: false, error };
  if (!moved || moved.length === 0) return { ok: false, already: true, error: null };

  await admin
    .rpc("enqueue_notification", {
      p_user_id: listing.seller_id,
      p_kind: "listing_archived",
      p_title: "Annonce retirée",
      p_body: reason
        ? `« ${listing.title} » a été retirée par l'équipe Mazed Immo. Motif : ${reason}`
        : `« ${listing.title} » a été retirée par l'équipe Mazed Immo. Contactez-nous pour en savoir plus.`,
      p_link: "/account/listings",
      p_payload: {
        vars: { title: listing.title, variant: reason ? "withReason" : "plain", ...(reason ? { reason } : {}) },
      },
    })
    .then(() => {}, () => {});

  return { ok: true };
}
