import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { paymentInstructions, fetchPayeeDetails, usablePayeeMethods } from "@/lib/payments";
import { isUuid } from "@/lib/uuid";
import { Link } from "@/i18n/navigation";
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
  searchParams: Promise<{ payment?: string | string[] }>;
}) {
  const rawParams = await searchParams;
  const paymentParam = Array.isArray(rawParams.payment) ? rawParams.payment[0] : rawParams.payment;
  const locale = await getLocale();

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/${locale}/login?next=${encodeURIComponent(`/payment/checkout?payment=${paymentParam ?? ""}`)}`,
    );
  }

  // A malformed id is not a payment: the lookup below would throw on the cast
  // and the page would land on its error boundary instead of a 404.
  if (!paymentParam || !isUuid(paymentParam)) notFound();

  // The payee rows in app_settings are admin-only, so with the seller's own
  // client this came back empty, fell back to the built-in example account, and
  // usablePayeeMethods then (correctly) refused it: every non-admin seller met
  // « Paiement momentanément indisponible » and could not pay at all.
  const payee = await fetchPayeeDetails(getServiceSupabase() ?? supabase);

  // `error` is captured, not discarded. The previous version destructured only
  // `data`, so a PostgREST failure was indistinguishable from "no such payment"
  // and surfaced as a 404 — which is precisely how a dropped column stayed
  // invisible for as long as it did.
  const { data: pay, error } = await supabase
    .from("payments")
    .select("id, user_id, kind, amount, status, metadata, reviewer_id, admin_notes")
    .eq("id", paymentParam)
    .maybeSingle();

  if (error) throw new Error(`checkout payment lookup failed: ${error.message}`);
  if (!pay || pay.user_id !== user.id) notFound();

  // A receipt an admin refused is sent again from here — the refusal's
  // notification says so and links here; this page used to bounce it to the
  // success page, which offered nothing a seller could do. A payment the
  // seller cancelled, or one already paid, has nothing to do here.
  const refused = pay.status === "failed" && pay.reviewer_id != null;
  if (pay.status !== "pending" && pay.status !== "pending_review" && !refused) {
    redirect(`/${locale}/payment/success?id=${pay.id}`);
  }

  const meta = (pay.metadata ?? {}) as { listing_id?: string; product_id?: string; shop_id?: string };
  const listing = await fetchListingSummary(meta.listing_id);
  // What is being paid for, said in the header: an agence's plan, a placement,
  // or (the original kind) an annonce's fee. The header said « Frais
  // d'annonce » for a plan too.
  const subject = await fetchSubject(pay.kind as string, meta, locale);

  // Only offer a method whose details are real — see usablePayeeMethods. With
  // none, refuse to take payment rather than print a fake account.
  const usable = usablePayeeMethods(payee);
  const tInstructions = await getTranslations("checkout.instructions");
  const instructions = paymentInstructions({
    paymentId: pay.id as string,
    amountTND: Number(pay.amount),
    payee,
    t: (key, values) => tInstructions(key, values),
  }).filter((m) => usable[m.value as "bank_transfer" | "d17"]);
  if (instructions.length === 0) return <PaymentUnavailable />;

  return (
    <CheckoutClient
      paymentId={pay.id as string}
      amount={Number(pay.amount)}
      listing={listing}
      subject={subject}
      instructions={instructions}
      locale={locale}
      receiptUnderReview={pay.status === "pending_review"}
      refusedReason={refused ? ((pay.admin_notes as string | null) ?? "") : null}
      // The seller can go back and fix the annonce before paying — a rejected
      // receipt is often a rejected LISTING in disguise. It returns here.
      editHref={
        listing && subject.kind === "fee" ? `/${locale}/annonces/nouvelle?draft=${listing.id}` : undefined
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
export type CheckoutSubject = { kind: "plan" | "promo" | "fee"; product: string | null; shop: string | null; shopId: string | null };

/** The plan or placement bought, by name in the page's language, and the agence it is for. */
async function fetchSubject(
  kind: string,
  meta: { product_id?: string; shop_id?: string },
  locale: string,
): Promise<CheckoutSubject> {
  const which = kind === "subscription" ? "plan" : kind === "promo" ? "promo" : "fee";
  const admin = getServiceSupabase();
  if (!admin || which === "fee") return { kind: which, product: null, shop: null, shopId: null };
  const [{ data: product }, { data: shop }] = await Promise.all([
    meta.product_id ? admin.from("products").select("name_fr, name_ar").eq("id", meta.product_id).maybeSingle() : Promise.resolve({ data: null }),
    meta.shop_id ? admin.from("shops").select("name").eq("id", meta.shop_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const p = product as { name_fr: string; name_ar: string | null } | null;
  return {
    kind: which,
    product: p ? (locale === "ar" ? p.name_ar || p.name_fr : p.name_fr) : null,
    shop: (shop as { name: string } | null)?.name ?? null,
    shopId: meta.shop_id ?? null,
  };
}

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

/**
 * Shown instead of transfer instructions when no payment method has real
 * details. Refusing is the point: see `usablePayeeMethods`.
 */
async function PaymentUnavailable() {
  const t = await getTranslations("checkout.unavailable");
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      <div className="w-full rounded-2xl border border-border bg-surface p-7">
        <h1 className="text-xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t("body")}
        </p>
        <div className="mt-6 space-y-2">
          <Link href="/account/listings" className="mazed-btn-luxe h-12 w-full text-[14px]">
            {t("myListings")}
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-11 w-full items-center justify-center rounded-[var(--radius)] border border-border bg-surface-2 text-[13px] font-semibold text-foreground"
          >
            {t("support")}
          </Link>
        </div>
      </div>
    </div>
  );
}
