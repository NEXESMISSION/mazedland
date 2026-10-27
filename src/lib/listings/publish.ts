import type { getServiceSupabase } from "@/lib/supabase/admin";
import { notifyMatchingRequests } from "@/lib/requests/server";
import { loadSettings } from "@/lib/settings/server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** How long a publication lasts: what its payment bought, else the active
 *  `listing_single` product, else `listing_default_days` (/admin/settings).
 *  Never a constant in a caller. */
export async function publicationDays(admin: Admin, feePaymentId: string | null): Promise<number> {
  if (feePaymentId) {
    const { data: pay } = await admin
      .from("payments")
      .select("metadata")
      .eq("id", feePaymentId)
      .maybeSingle();
    const d = Number((pay?.metadata as { duration_days?: unknown } | null)?.duration_days);
    if (Number.isFinite(d) && d > 0) return d;
  }
  const { data: prod } = await admin
    .from("products")
    .select("duration_days")
    .eq("kind", "listing_single")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const d = Number(prod?.duration_days);
  if (Number.isFinite(d) && d > 0) return d;
  return (await loadSettings(admin)).listing_default_days;
}

/**
 * Put an annonce in the catalogue and tell its seller.
 *
 * The one place a listing goes live — an admin's approval and the automatic
 * path both come through here, so they set the same columns, clear the same
 * review state and send the same notification. `reviewerId` is the admin, or
 * null when the rules published it. Runs on the service-role client, which is
 * what `_listings_guard_publish` (0146) lets through.
 */
export async function publishListing(
  admin: Admin,
  listing: { id: string; seller_id: string; title: string; fee_payment_id: string | null },
  opts: { reviewerId: string | null; days?: number; extra?: Record<string, unknown> },
): Promise<{ ok: true; expiresAt: Date } | { ok: false; error: unknown }> {
  const d = opts.days ?? (await publicationDays(admin, listing.fee_payment_id));
  const now = new Date();
  const expires = new Date(now.getTime() + d * 86_400_000);

  const { error } = await admin
    .from("listings")
    .update({
      ...opts.extra,
      status: "published",
      published_at: now.toISOString(),
      expires_at: expires.toISOString(),
      reviewed_by: opts.reviewerId,
      reviewed_at: opts.reviewerId ? now.toISOString() : null,
      rejection_reason: null,
      review_flags: [],
    })
    .eq("id", listing.id);
  if (error) return { ok: false, error };

  // Reports that were waiting on this annonce have been dealt with: a later
  // wave counts from zero.
  await admin
    .from("listing_reports")
    .update({ resolved_at: now.toISOString() })
    .eq("listing_id", listing.id)
    .is("resolved_at", null)
    .then(() => {}, () => {});

  await admin
    .rpc("enqueue_notification", {
      p_user_id: listing.seller_id,
      p_kind: "listing_published",
      p_title: "Votre annonce est en ligne",
      p_body: `« ${listing.title} » est visible jusqu'au ${expires.toLocaleDateString("fr-FR")}.`,
      p_link: `/annonces/${listing.id}`,
      p_payload: { vars: { title: listing.title, expires_at: expires.toISOString() } },
    })
    .then(() => {}, () => {});

  // The people who asked for exactly this (0168). Never throws.
  await notifyMatchingRequests(admin, listing.id);

  return { ok: true, expiresAt: expires };
}
