import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { depositForOpening } from "@/lib/utils";
import { paymentInstructions } from "@/lib/payments";
import { CheckoutClient } from "./CheckoutClient";

export const dynamic = "force-dynamic";

export type CheckoutKind = "deposit" | "buy_now" | "final_payment";

const VALID_KINDS: CheckoutKind[] = ["deposit", "buy_now", "final_payment"];

/**
 * Manual-receipt checkout — replaces the gateway-redirect flow.
 *
 * Entry URLs:
 *   /payment/checkout?type=deposit|buy_now|final_payment&auction=<uuid>
 *     → server creates (or reuses) a pending payment row, renders the
 *       provider chooser + instructions + receipt upload form.
 *
 *   /payment/checkout?payment=<uuid>
 *     → re-upload mode (after admin rejection or browser refresh).
 *
 * Auction-tied amounts are recomputed server-side every time — the
 * client never gets to dictate what they owe.
 */
export default async function CheckoutEntry({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; auction?: string; payment?: string }>;
}) {
  const { type, auction: auctionId, payment: paymentParam } = await searchParams;
  const locale = await getLocale();

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const back =
      paymentParam
        ? `/payment/checkout?payment=${paymentParam}`
        : `/payment/checkout?type=${type}&auction=${auctionId}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(back)}`);
  }

  // ─── Re-upload mode ───
  if (paymentParam) {
    const { data: pay } = await supabase
      .from("payments")
      .select("id, user_id, kind, amount, auction_id, status")
      .eq("id", paymentParam)
      .single();
    if (!pay || pay.user_id !== user.id) notFound();
    if (pay.status !== "pending" && pay.status !== "pending_review") {
      redirect(`/${locale}/payment/success?id=${pay.id}`);
    }

    const auction = pay.auction_id
      ? await fetchAuctionSummary(pay.auction_id)
      : null;

    return (
      <CheckoutClient
        paymentId={pay.id as string}
        kind={(pay.kind as CheckoutKind) ?? "deposit"}
        amount={Number(pay.amount)}
        auction={auction}
        instructions={paymentInstructions({
          paymentId: pay.id as string,
          amountTND: Number(pay.amount),
        })}
        locale={locale}
        reupload={pay.status === "pending_review"}
      />
    );
  }

  // ─── Entry from auction page (deposit / buy_now) ───
  if (!type || !VALID_KINDS.includes(type as CheckoutKind)) notFound();
  if (!auctionId) notFound();
  const kind = type as CheckoutKind;

  const { data: auctionRow } = await supabase
    .from("auctions")
    .select(
      `id, status, listing_type, opening_price, sale_price, buy_now_price, winner_user_id, winner_amount,
       property:properties (id, title, governorate, owner_id, photos:property_photos (id, storage_path, sort_order))`,
    )
    .eq("id", auctionId)
    .single();
  if (!auctionRow) notFound();

  const a = auctionRow as unknown as {
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

  // Compute authoritative amount.
  let amount = 0;
  switch (kind) {
    case "deposit":
      amount = depositForOpening(Number(a.opening_price));
      break;
    case "buy_now":
      amount =
        a.listing_type === "direct"
          ? Number(a.sale_price ?? 0)
          : Number(a.buy_now_price ?? 0);
      break;
    case "final_payment":
      amount = Number(a.winner_amount ?? 0);
      break;
  }
  if (!amount || amount <= 0) notFound();

  // Find or create a pending payment row for this user+auction+kind.
  const dbKind =
    kind === "deposit" ? "deposit_lock" : kind === "buy_now" ? "buy_now" : "final_payment";

  const { data: existing } = await supabase
    .from("payments")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("auction_id", auctionId)
    .eq("kind", dbKind)
    .in("status", ["pending", "pending_review"])
    .maybeSingle();

  let paymentId: string;
  if (existing) {
    paymentId = existing.id as string;
  } else {
    // Service-role insert so we don't depend on the user's RLS policy
    // for `payments.insert`. The row is owned by the user via user_id.
    const admin = getServiceSupabase();
    if (!admin) notFound();
    const { data: created, error } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        kind: dbKind,
        provider: "bank_transfer",
        amount,
        auction_id: auctionId,
        status: "pending",
        metadata: { initiated_at: new Date().toISOString(), checkout_kind: kind },
      })
      .select("id")
      .single();
    if (error || !created) notFound();
    paymentId = created.id as string;
  }

  const heroPhoto = a.property.photos?.sort(
    (x, y) => x.sort_order - y.sort_order,
  )[0];

  return (
    <CheckoutClient
      paymentId={paymentId}
      kind={kind}
      amount={amount}
      auction={{
        id: a.id,
        title: a.property.title,
        governorate: a.property.governorate,
        heroPhotoPath: heroPhoto?.storage_path ?? null,
      }}
      instructions={paymentInstructions({ paymentId, amountTND: amount })}
      locale={locale}
      reupload={false}
    />
  );
}

async function fetchAuctionSummary(auctionId: string) {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("auctions")
    .select(
      `id, property:properties (id, title, governorate, photos:property_photos (id, storage_path, sort_order))`,
    )
    .eq("id", auctionId)
    .single();
  if (!data) return null;
  const a = data as unknown as {
    id: string;
    property: {
      title: string;
      governorate: string;
      photos: { storage_path: string; sort_order: number }[];
    };
  };
  const hero = a.property.photos?.sort((x, y) => x.sort_order - y.sort_order)[0];
  return {
    id: a.id,
    title: a.property.title,
    governorate: a.property.governorate,
    heroPhotoPath: hero?.storage_path ?? null,
  };
}
