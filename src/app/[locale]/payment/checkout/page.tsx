import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { parseMonetizationSettings, resolveDeposit } from "@/lib/pricing";
import { paymentInstructions, fetchPayeeDetails } from "@/lib/payments";
import { CheckoutClient } from "./CheckoutClient";

export const dynamic = "force-dynamic";

export type CheckoutKind = "deposit" | "buy_now" | "final_payment" | "listing_fee";

const VALID_KINDS: CheckoutKind[] = ["deposit", "buy_now", "final_payment", "listing_fee"];

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

  const payee = await fetchPayeeDetails(supabase);

  // ─── Re-upload mode ───
  if (paymentParam) {
    const { data: pay } = await supabase
      .from("payments")
      .select("id, user_id, kind, amount, auction_id, property_id, status")
      .eq("id", paymentParam)
      .single();
    if (!pay || pay.user_id !== user.id) notFound();
    if (pay.status !== "pending" && pay.status !== "pending_review") {
      redirect(`/${locale}/payment/success?id=${pay.id}`);
    }

    const auction = pay.auction_id
      ? await fetchAuctionSummary(pay.auction_id)
      : pay.property_id
        ? await fetchPropertySummary(pay.property_id)
        : null;

    const mappedKind = mapDbKindToCheckoutKind(pay.kind);
    // Listing-fee payments are tied to an editable property → let the seller
    // go back and fix the listing before paying. Returns to this checkout.
    const editHref =
      mappedKind === "listing_fee" && pay.property_id
        ? `/${locale}/sell/${pay.property_id}/edit?return_payment=${pay.id}`
        : undefined;

    return (
      <CheckoutClient
        paymentId={pay.id as string}
        kind={mappedKind}
        amount={Number(pay.amount)}
        auction={auction}
        instructions={paymentInstructions({
          paymentId: pay.id as string,
          amountTND: Number(pay.amount),
          payee,
        })}
        locale={locale}
        reupload={pay.status === "pending_review"}
        editHref={editHref}
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

  // Final payment is WINNER-ONLY. Without this gate a losing bidder could open
  // /payment/checkout?type=final_payment&auction=X and be charged for a win
  // they don't hold — the capture would then no-op (auction already closed),
  // taking their money for nothing. Only the recorded winner of a settled
  // auction may pay the balance.
  if (kind === "final_payment") {
    const isWinner = a.winner_user_id === user.id;
    const settled = a.status === "awarded" || a.status === "ended_sold";
    if (!isWinner || !settled) {
      redirect(`/${locale}/auctions/${a.id}`);
    }
  }

  // Compute authoritative amount.
  let amount = 0;
  switch (kind) {
    case "deposit": {
      const { data: depRow } = await supabase
        .from("app_settings").select("value").eq("key", "deposit").maybeSingle();
      const depCfg = parseMonetizationSettings(
        new Map<string, unknown>([["deposit", depRow?.value]]),
      ).deposit;
      amount = resolveDeposit(depCfg, Number(a.opening_price)).amount;
      break;
    }
    case "buy_now": {
      const full =
        a.listing_type === "direct"
          ? Number(a.sale_price ?? 0)
          : Number(a.buy_now_price ?? 0);
      // Net any active deposit the buyer already locked on THIS auction. The
      // buy-now RPC (close_auction_on_purchase) only releases LOSING bidders'
      // deposits and deliberately keeps the buyer's own caution as "part of
      // the purchase" — so charging the full buy-now price on top double-pays
      // them. Mirrors the final_payment netting. Direct listings have no
      // deposit, so credit resolves to 0 and the full sale price is charged.
      const { data: depRows } = await supabase
        .from("auction_deposits")
        .select("amount")
        .eq("auction_id", auctionId)
        .eq("user_id", user.id)
        .is("released_at", null)
        .is("forfeited_at", null)
        .order("amount", { ascending: false })
        .limit(1);
      const credit = Number(depRows?.[0]?.amount ?? 0);
      amount = Math.max(0, Math.round((full - credit) * 100) / 100);
      break;
    }
    case "final_payment": {
      // Net the deposit already paid: the caution is "part of the purchase",
      // so the final balance is the hammer price minus the winner's locked
      // deposit. Without this the winner pays deposit + full price (double-pay).
      const full = Number(a.winner_amount ?? 0);
      const { data: depRows } = await supabase
        .from("auction_deposits")
        .select("amount")
        .eq("auction_id", auctionId)
        .eq("user_id", user.id)
        .is("forfeited_at", null)
        .order("amount", { ascending: false })
        .limit(1);
      const credit = Number(depRows?.[0]?.amount ?? 0);
      amount = Math.max(0, Math.round((full - credit) * 100) / 100);
      break;
    }
  }
  if (!amount || amount <= 0) notFound();

  // Find or create a pending payment row for this user+auction+kind.
  const dbKind =
    kind === "deposit" ? "deposit_lock" : kind === "buy_now" ? "buy_now" : "final_payment";

  // Already paid? Don't let the user (or a stale notification link) open a
  // second checkout for a purchase that's already captured — a second receipt
  // + admin capture would double-charge them and inflate seller earnings.
  // Bounce to the auction (which shows the settled/won state).
  const { data: alreadyPaid } = await supabase
    .from("payments")
    .select("id")
    .eq("user_id", user.id)
    .eq("auction_id", auctionId)
    .eq("kind", dbKind)
    .eq("status", "captured")
    .limit(1);
  if (alreadyPaid && alreadyPaid.length > 0) {
    redirect(`/${locale}/auctions/${a.id}`);
  }

  // Find the latest reusable payment. NOTE: use limit(1), not maybeSingle —
  // maybeSingle THROWS when >1 row matches, which made `existing` null and
  // spawned a fresh row on every visit (the runaway-duplicate bug).
  const { data: existingRows } = await supabase
    .from("payments")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("auction_id", auctionId)
    .eq("kind", dbKind)
    .in("status", ["pending", "pending_review"])
    .order("created_at", { ascending: false })
    .limit(1);

  let paymentId: string;
  if (existingRows && existingRows.length > 0) {
    paymentId = existingRows[0].id as string;
  } else {
    // Service-role insert so we don't depend on the user's RLS policy.
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
    if (created) {
      paymentId = created.id as string;
    } else {
      // A concurrent request (or the unique index in migration 0041) beat
      // us — re-fetch the row it created instead of failing.
      const { data: race } = await admin
        .from("payments")
        .select("id")
        .eq("user_id", user.id)
        .eq("auction_id", auctionId)
        .eq("kind", dbKind)
        .in("status", ["pending", "pending_review"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (!race || race.length === 0) {
        notFound();
        return null as never;
      }
      paymentId = race[0].id as string;
      void error;
    }
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
      instructions={paymentInstructions({ paymentId, amountTND: amount, payee })}
      locale={locale}
      reupload={false}
    />
  );
}

/**
 * Map the DB-side payment_kind enum value to the CheckoutKind union
 * the client component understands. Older kinds in the DB (legacy
 * deposit_lock) map to the modern 'deposit' label.
 */
function mapDbKindToCheckoutKind(dbKind: string): CheckoutKind {
  switch (dbKind) {
    case "deposit_lock":
    case "deposit":
      return "deposit";
    case "buy_now":
      return "buy_now";
    case "final_payment":
      return "final_payment";
    case "listing_fee":
      return "listing_fee";
    default:
      return "deposit";
  }
}

async function fetchPropertySummary(propertyId: string) {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("properties")
    .select(
      `id, title, governorate, photos:property_photos (storage_path, sort_order)`,
    )
    .eq("id", propertyId)
    .single();
  if (!data) return null;
  const p = data as unknown as {
    id: string;
    title: string;
    governorate: string;
    photos: { storage_path: string; sort_order: number }[];
  };
  const hero = p.photos?.sort((x, y) => x.sort_order - y.sort_order)[0];
  return {
    id: p.id,
    title: p.title,
    governorate: p.governorate,
    heroPhotoPath: hero?.storage_path ?? null,
  };
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
