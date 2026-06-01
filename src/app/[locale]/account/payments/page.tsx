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
  type DepositLifecycle,
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
  auction_id: string | null;
  property_id: string | null;
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
      "id, kind, provider, amount, status, receipt_url, created_at, auction_id, property_id, admin_notes",
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
          Cautions, frais d&apos;annonce, achats et remboursements.
        </p>
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <Wallet className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">Aucun paiement pour le moment.</p>
          <Link
            href="/properties"
            className="batta-btn-luxe tap-target mt-5 inline-flex px-5 py-2.5 text-[12.5px]"
          >
            Parcourir les enchères
          </Link>
        </div>
      </div>
    );
  }

  // ── Enrich with the linked auction / property (title, location, cover). ──
  const auctionIds = [
    ...new Set(payments.filter((p) => p.auction_id).map((p) => p.auction_id as string)),
  ];
  const propertyIds = [
    ...new Set(
      payments.filter((p) => p.property_id && !p.auction_id).map((p) => p.property_id as string),
    ),
  ];

  const entityByAuction = new Map<string, Entity>();
  const entityByProperty = new Map<string, Entity>();

  const [aucsRes, propsRes, depsRes] = await Promise.all([
    auctionIds.length
      ? supabase
          .from("auctions")
          .select(
            `id, property:properties ( title, governorate, photos:property_photos (storage_path, sort_order) )`,
          )
          .in("id", auctionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    propertyIds.length
      ? supabase
          .from("properties")
          .select(`id, title, governorate, photos:property_photos (storage_path, sort_order)`)
          .in("id", propertyIds)
      : Promise.resolve({ data: [] as unknown[] }),
    // Caution lifecycle, keyed by the payment row that created the deposit.
    supabase
      .from("auction_deposits")
      .select("payment_id, amount, released_at, refunded_at, forfeited_at")
      .eq("user_id", user!.id),
  ]);

  for (const a of (aucsRes.data ?? []) as Array<{
    id: string;
    property: { title: string; governorate: string; photos: Photo[] } | null;
  }>) {
    entityByAuction.set(a.id, {
      title: a.property?.title ?? null,
      governorate: a.property?.governorate ?? null,
      coverUrl: coverFrom(a.property?.photos),
    });
  }
  for (const pr of (propsRes.data ?? []) as Array<{
    id: string;
    title: string;
    governorate: string;
    photos: Photo[];
  }>) {
    entityByProperty.set(pr.id, {
      title: pr.title ?? null,
      governorate: pr.governorate ?? null,
      coverUrl: coverFrom(pr.photos),
    });
  }

  const depByPayment = new Map<string, { amount: number; status: DepositLifecycle }>();
  for (const d of (depsRes.data ?? []) as Array<{
    payment_id: string | null;
    amount: number;
    released_at: string | null;
    refunded_at: string | null;
    forfeited_at: string | null;
  }>) {
    if (!d.payment_id) continue;
    const status: DepositLifecycle = d.refunded_at
      ? "refunded"
      : d.forfeited_at
        ? "forfeited"
        : d.released_at
          ? "to_refund"
          : "locked";
    depByPayment.set(d.payment_id, { amount: Number(d.amount), status });
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
    const entity = p.auction_id
      ? entityByAuction.get(p.auction_id)
      : p.property_id
        ? entityByProperty.get(p.property_id)
        : undefined;
    const dep = depByPayment.get(p.id);
    return {
      id: p.id,
      kind: p.kind,
      provider: p.provider,
      amount: Number(p.amount),
      status: p.status,
      createdAt: p.created_at,
      adminNotes: p.admin_notes ?? null,
      receiptUrl: signed.get(p.id) ?? null,
      auctionId: p.auction_id ?? null,
      title: entity?.title ?? null,
      governorate: entity?.governorate ?? null,
      coverUrl: entity?.coverUrl ?? null,
      depositStatus: p.kind === "deposit_lock" ? (dep?.status ?? null) : null,
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
  let lockedTotal = 0;
  let refundedTotal = 0;
  for (const d of depByPayment.values()) {
    if (d.status === "locked") lockedTotal += d.amount;
    if (d.status === "refunded") refundedTotal += d.amount;
  }

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
