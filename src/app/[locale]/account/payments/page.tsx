import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { Wallet } from "lucide-react";
import { FocusRowHighlight } from "@/components/ui/FocusRowHighlight";
import {
  PaymentsClient,
  type PaymentVM,
  type PaymentsSummary,
} from "./PaymentsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PaymentRow = {
  id: string;
  kind: string;
  provider: string;
  amount: number;
  status: string;
  receipt_url: string | null;
  created_at: string;
  metadata: { listing_id?: string } | null;
  admin_notes: string | null;
};

type Photo = { storage_path: string; sort_order: number };
type Entity = { title: string | null; governorate: string | null; coverUrl: string | null };

/** Buyer-spend kinds that count toward "Total dépensé" once captured.
 *  `deposit_lock` is excluded — a locked caution is tracked separately and
 *  shouldn't be double-counted as spend. */
const SPEND_KINDS = new Set(["buy_now", "final_payment", "inspection_fee", "listing_fee"]);

function coverFrom(photos: Photo[] | null | undefined): string | null {
  const cover = (photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)[0];
  return cover ? propertyPhotoUrl(cover.storage_path) : null;
}

export default async function MyPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dateLocale = await getLocale();
  const supabase = await getServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data } = await supabase
    .from("payments")
    .select(
      "id, kind, provider, amount, status, receipt_url, created_at, metadata, admin_notes",
    )
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const payments = (data ?? []) as PaymentRow[];

  // Empty state — keep the gold-framed CTA.
  if (payments.length === 0) {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-16 lg:max-w-[var(--max-w-content)]">
        <span className="batta-eyebrow">Historique</span>
        <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">Mes paiements</h1>
        <p className="mt-1.5 text-[12px] text-muted">
          Vos frais de publication et leur statut.
        </p>
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <Wallet className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">Aucun paiement pour le moment.</p>
          <Link
            href="/annonces"
            className="batta-btn-luxe tap-target mt-5 inline-flex px-5 py-2.5 text-[12.5px]"
          >
            Parcourir les annonces
          </Link>
        </div>
      </div>
    );
  }

  // ── Enrich each payment with the annonce it bought ────────────────────────
  //
  // Through `metadata.listing_id`, not a foreign key. This block used to read
  // `auctions`, `properties`, `property_photos` and `auction_deposits` — all
  // four dropped by migration 0153 — and the select above named
  // `payments.auction_id` and `payments.property_id`, which went with them.
  //
  // PostgREST refuses a whole request when a select names a missing column, so
  // `data` came back null, `payments` coerced to `[]`, and every user saw
  // "Aucun paiement pour le moment" no matter what they held. HTTP 200, full
  // layout, zero rows — the failure mode a Server Component makes invisible.
  const listingIds = [
    ...new Set(
      payments
        .map((p) => p.metadata?.listing_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const entityByListing = new Map<string, Entity>();
  if (listingIds.length) {
    const { data: rows } = await supabase
      .from("listings")
      .select("id, title, governorate, photos:listing_photos (storage_path, sort_order)")
      .in("id", listingIds);
    for (const l of (rows ?? []) as Array<{
      id: string;
      title: string;
      governorate: string;
      photos: Photo[] | null;
    }>) {
      entityByListing.set(l.id, {
        title: l.title ?? null,
        governorate: l.governorate ?? null,
        coverUrl: coverFrom(l.photos ?? []),
      });
    }
  }

  // ── Sign receipts (private bucket). ──
  const signed = new Map<string, string>();
  await Promise.all(
    payments
      .filter((p) => p.receipt_url)
      .map(async (p) => {
        const { data: s } = await supabase.storage
          .from("receipts")
          .createSignedUrl(p.receipt_url as string, 3600);
        if (s?.signedUrl) signed.set(p.id, s.signedUrl);
      }),
  );

  // ── Build view-models + summary. ──
  const vms: PaymentVM[] = payments.map((p) => {
    const listingId = p.metadata?.listing_id ?? null;
    const entity = listingId ? entityByListing.get(listingId) : undefined;
    return {
      id: p.id,
      kind: p.kind,
      provider: p.provider,
      amount: Number(p.amount),
      status: p.status,
      createdAt: p.created_at,
      adminNotes: p.admin_notes ?? null,
      receiptUrl: signed.get(p.id) ?? null,
      auctionId: null,
      title: entity?.title ?? null,
      governorate: entity?.governorate ?? null,
      coverUrl: entity?.coverUrl ?? null,
      // No payment kind carries a caution lifecycle any more.
      depositStatus: null,
    };
  });

  // Rows the user cancelled themselves are stored as `failed` with this
  // exact marker; they're not "to do" and shouldn't be counted as such.
  const CANCELLED_NOTE = "Annulé par l'utilisateur";
  let actionCount = 0;
  let reviewCount = 0;
  let spentTotal = 0;
  for (const p of payments) {
    const cancelled = p.status === "failed" && p.admin_notes === CANCELLED_NOTE;
    if (p.status === "pending" || (p.status === "failed" && !cancelled)) actionCount += 1;
    if (p.status === "pending_review") reviewCount += 1;
    if (p.status === "captured" && SPEND_KINDS.has(p.kind)) spentTotal += Number(p.amount);
  }
  // Cautions were the only thing that could be "locked" or "refunded", and
  // they went with the auction product. Kept at zero rather than removed from
  // `PaymentsSummary`: the client renders these tiles conditionally on > 0, so
  // they simply stop appearing, and the shape stays stable for the day a
  // refundable payment kind exists again.
  const lockedTotal = 0;
  const refundedTotal = 0;

  const summary: PaymentsSummary = {
    actionCount,
    reviewCount,
    lockedTotal,
    spentTotal,
    refundedTotal,
  };

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-16 lg:max-w-[var(--max-w-content)]">
      <FocusRowHighlight idPrefix="pay-" />
      <span className="batta-eyebrow">Historique</span>
      <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">Mes paiements</h1>
      <p className="mt-1.5 text-[12px] text-muted">
        Cautions, achats, frais et remboursements.
      </p>

      <PaymentsClient payments={vms} summary={summary} locale={dateLocale} />
    </div>
  );
}
