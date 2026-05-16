import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { depositForOpening } from "@/lib/utils";
import { CheckoutClient } from "./CheckoutClient";

export const dynamic = "force-dynamic";

export type CheckoutKind = "deposit" | "buy_now" | "final_payment";

const VALID_KINDS: CheckoutKind[] = ["deposit", "buy_now", "final_payment"];

/**
 * Unified payment checkout — replaces the scattered "click button →
 * endpoint inline-captures → reload" approach with a real
 * checkout-page-then-gateway redirect. Mimics the mazed-auto pattern.
 *
 *   Entry URL: /payment/checkout?type=deposit|buy_now|final_payment
 *              &auction=<uuid>
 *
 * The page validates the auction context server-side, computes the
 * authoritative amount from the DB (we don't trust the client to say
 * what they owe), and renders a client component with the provider
 * selector + summary. Submit then POSTs to the type-specific endpoint,
 * which returns a `hostedUrl` we redirect to (mock provider → our
 * /payment/mock; real provider → Konnect/Paymee/etc).
 */
export default async function CheckoutEntry({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; auction?: string }>;
}) {
  const { type, auction: auctionId } = await searchParams;
  const locale = await getLocale();

  if (!type || !VALID_KINDS.includes(type as CheckoutKind)) {
    notFound();
  }
  if (!auctionId) {
    notFound();
  }
  const kind = type as CheckoutKind;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/${locale}/login?next=${encodeURIComponent(
        `/payment/checkout?type=${kind}&auction=${auctionId}`,
      )}`,
    );
  }

  // Fetch the auction + property so we can compute the amount the user
  // actually owes (deposit = 10% of opening, buy_now = sale_price /
  // buy_now_price) and show the context they're paying for.
  const { data: auction } = await supabase
    .from("auctions")
    .select(
      `id, status, listing_type, opening_price, sale_price, buy_now_price, winner_user_id, winner_amount,
       property:properties (id, title, governorate, owner_id, photos:property_photos (id, storage_path, sort_order))`,
    )
    .eq("id", auctionId)
    .single();

  if (!auction) notFound();

  const a = auction as unknown as {
    id: string;
    status: string;
    listing_type: "auction" | "direct";
    opening_price: number;
    sale_price: number | null;
    buy_now_price: number | null;
    winner_user_id: string | null;
    winner_amount: number | null;
    property: {
      id: string;
      title: string;
      governorate: string;
      owner_id: string;
      photos: { id: string; storage_path: string; sort_order: number }[];
    };
  };

  if (a.property.owner_id === user.id) {
    redirect(`/${locale}/auctions/${a.id}`);
  }

  // Compute the authoritative amount from DB. The client only sees this
  // server-rendered number — no chance of forging a lower price.
  let amount: number | null = null;
  let kindLabel = "";
  let kindBody = "";
  switch (kind) {
    case "deposit":
      amount = depositForOpening(Number(a.opening_price));
      kindLabel = "Caution de participation";
      kindBody =
        "10% du prix d'ouverture — verrouillée pour rejoindre l'enchère. Remboursée sous 24 h si vous ne gagnez pas.";
      break;
    case "buy_now":
      amount =
        a.listing_type === "direct"
          ? Number(a.sale_price ?? 0)
          : Number(a.buy_now_price ?? 0);
      kindLabel =
        a.listing_type === "direct" ? "Achat direct" : "Achat immédiat";
      kindBody =
        a.listing_type === "direct"
          ? "Prix fixe. L'achat clôture l'annonce immédiatement."
          : "Prix de raccourci. Vous remportez l'enchère sans attendre la clôture.";
      break;
    case "final_payment":
      // Final-payment = winner pays the balance owed = winner_amount minus deposit.
      // The /final-payment endpoint enforces this; the displayed amount
      // is what the buyer actually owes (full winning amount; deposit
      // was already captured and is credited against the balance
      // server-side).
      amount = Number(a.winner_amount ?? 0);
      kindLabel = "Paiement final";
      kindBody =
        "Solde du prix d'adjudication, déduction faite de la caution déjà verrouillée.";
      break;
  }
  if (!amount || amount <= 0) {
    notFound();
  }

  const heroPhoto = a.property.photos?.sort((x, y) => x.sort_order - y.sort_order)[0];

  return (
    <CheckoutClient
      kind={kind}
      kindLabel={kindLabel}
      kindBody={kindBody}
      amount={amount}
      auction={{
        id: a.id,
        title: a.property.title,
        governorate: a.property.governorate,
        heroPhotoPath: heroPhoto?.storage_path ?? null,
      }}
      locale={locale}
    />
  );
}
