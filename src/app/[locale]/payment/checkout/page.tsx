import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { paymentInstructions, fetchPayeeDetails } from "@/lib/payments";
import { CheckoutClient } from "./CheckoutClient";

export const dynamic = "force-dynamic";

export type CheckoutKind = "listing_fee";

/**
 * Manual-receipt checkout — the one place a seller pays for a publication.
 *
 *   /payment/checkout?payment=<uuid>
 *
 * The seller submits an annonce, `/api/annonces/[id]/submit` creates a
 * `listing_fee` payment and returns its id, and the wizard sends them here to
 * choose a provider, read the transfer instructions and upload a receipt. The
 * same URL is what the `listing_submitted` notification links to, and what
 * `/account/listings`, `/account/payments` and the renew button all point at.
 *
 * WHY THIS FILE WAS REWRITTEN. It selected `payments.auction_id` and
 * `payments.property_id`, both of which migration 0153 dropped with the auction
 * product. PostgREST refuses the whole request when a select names a column
 * that does not exist, so `pay` came back null and line 56 called `notFound()`.
 *
 * That made this a hard 404 — not a degraded page — on the ONLY destination in
 * the monetisation flow. Six live surfaces pushed sellers into it, and no
 * publication fee could be paid at all. The admin half had been converted
 * correctly (it resolves the annonce through `metadata.listing_id`); only the
 * seller-facing half was missed, and nothing caught it because the page kept
 * compiling and the error is a runtime one.
 *
 * The auction entry mode is gone with it. It took `?type=deposit|buy_now|
 * final_payment&auction=<uuid>`, recomputed the amount from the lot, and read
 * `auctions`, `properties`, `property_photos` and `auction_deposits` — four
 * dropped tables. There is one kind of payment now.
 */
export default async function CheckoutEntry({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment: paymentParam } = await searchParams;
  const locale = await getLocale();

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/${locale}/login?next=${encodeURIComponent(`/payment/checkout?payment=${paymentParam ?? ""}`)}`,
    );
  }

  if (!paymentParam) notFound();

  const payee = await fetchPayeeDetails(supabase);

  // `error` is captured, not discarded. The previous version destructured only
  // `data`, so a PostgREST failure was indistinguishable from "no such payment"
  // and surfaced as a 404 — which is precisely how a dropped column stayed
  // invisible for as long as it did.
  const { data: pay, error } = await supabase
    .from("payments")
    .select("id, user_id, kind, amount, status, metadata")
    .eq("id", paymentParam)
    .maybeSingle();

  if (error) throw new Error(`checkout payment lookup failed: ${error.message}`);
  if (!pay || pay.user_id !== user.id) notFound();

  if (pay.status !== "pending" && pay.status !== "pending_review") {
    redirect(`/${locale}/payment/success?id=${pay.id}`);
  }

  const listing = await fetchListingSummary(
    (pay.metadata as { listing_id?: string } | null)?.listing_id,
  );

  return (
    <CheckoutClient
      paymentId={pay.id as string}
      amount={Number(pay.amount)}
      listing={listing}
      instructions={paymentInstructions({
        paymentId: pay.id as string,
        amountTND: Number(pay.amount),
        payee,
      })}
      locale={locale}
      reupload={pay.status === "pending_review"}
      // The seller can go back and fix the annonce before paying — a rejected
      // receipt is often a rejected LISTING in disguise. It returns here.
      editHref={
        listing ? `/${locale}/annonces/nouvelle?draft=${listing.id}` : undefined
      }
    />
  );
}

/**
 * The annonce this fee buys.
 *
 * Resolved through `metadata.listing_id`, not a foreign key: `payments` has no
 * column pointing at `listings`, and the one it used to have pointed at
 * `properties`, which is gone. Every v3 fee carries its subject in metadata,
 * which is also why `/api/annonces/[id]/submit` looks its own payments up with
 * `.contains("metadata", { listing_id })`.
 *
 * Returns null rather than throwing when the annonce has since been deleted —
 * the receipt still needs paying, and a checkout with no thumbnail is better
 * than a 404 over a missing photo.
 */
async function fetchListingSummary(listingId: string | undefined) {
  if (!listingId) return null;
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("listings")
    .select("id, title, governorate, photos:listing_photos (storage_path, sort_order)")
    .eq("id", listingId)
    .maybeSingle();
  if (!data) return null;
  const l = data as unknown as {
    id: string;
    title: string;
    governorate: string;
    photos: { storage_path: string; sort_order: number }[] | null;
  };
  const hero = (l.photos ?? []).slice().sort((x, y) => x.sort_order - y.sort_order)[0];
  return {
    id: l.id,
    title: l.title,
    governorate: l.governorate,
    heroPhotoPath: hero?.storage_path ?? null,
  };
}
