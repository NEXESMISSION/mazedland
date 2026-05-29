import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatTND } from "@/lib/utils";
import { PaymentsQueueList, type PaymentReviewItem } from "../../payments/PaymentsQueueList";
import { CautionActions, type CautionRow } from "./CautionActions";
import {
  ChevronLeft, Gavel, MapPin, Receipt, Banknote, Building2, Trophy, ExternalLink,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KIND_LABEL: Record<string, string> = {
  listing_fee: "Frais de création", deposit_lock: "Caution", buy_now: "Achat immédiat",
  final_payment: "Paiement final", commission: "Commission", deposit_release: "Remboursement",
};
const fmt = (n: number) => `${formatTND(n, "fr")} TND`;

/**
 * Admin per-auction work surface. Reached by clicking an auction box in any
 * queue — shows (and lets you action) everything tied to one lot:
 * creation-fee receipt, entry payments, and cautions. Receipts run through
 * the shared PaymentsQueueList (validate/refuse + promo modal); cautions
 * through CautionActions (prepare / refund / forfeit).
 */
export default async function AdminAuctionView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();

  const { data: aRaw } = await sb
    .from("auctions")
    .select(`id, type, listing_type, status, opening_price, current_price, winner_user_id, winner_amount, ends_at,
      property:properties ( id, title, governorate, owner_id, status )`)
    .eq("id", id)
    .single();
  if (!aRaw) notFound();
  const a = aRaw as unknown as {
    id: string; listing_type: string; status: string; opening_price: number; current_price: number | null;
    winner_user_id: string | null; winner_amount: number | null;
    property: { id: string; title: string; governorate: string } | null;
  };
  const propId = a.property?.id ?? null;
  const propTitle = a.property?.title ?? "—";
  const propGov = a.property?.governorate ?? "";

  const PSEL = "id, user_id, kind, provider, amount, status, receipt_url, receipt_uploaded_at, admin_notes, reviewed_at, metadata, auction_id, property_id";
  const [entryRes, feeRes, depRes] = await Promise.all([
    sb.from("payments").select(PSEL).eq("auction_id", id).order("receipt_uploaded_at", { ascending: false }),
    propId
      ? sb.from("payments").select(PSEL).eq("property_id", propId).eq("kind", "listing_fee").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Pay[] }),
    sb.from("auction_deposits")
      .select("id, user_id, amount, released_at, refunded_at, forfeited_at, refund_ref")
      .eq("auction_id", id).order("created_at", { ascending: true }),
  ]);

  type Pay = {
    id: string; user_id: string; kind: string; provider: string; amount: number; status: string;
    receipt_url: string | null; receipt_uploaded_at: string | null; admin_notes: string | null;
    reviewed_at: string | null; metadata: Record<string, unknown> | null;
  };
  const entry = (entryRes.data ?? []) as Pay[];
  const fees = (feeRes.data ?? []) as Pay[];
  type Dep = { id: string; user_id: string; amount: number; released_at: string | null; refunded_at: string | null; forfeited_at: string | null; refund_ref: string | null };
  const deposits = (depRes.data ?? []) as Dep[];

  // names + phones
  const uids = Array.from(new Set([...entry, ...fees, ...deposits].map((r) => r.user_id).concat(a.winner_user_id ? [a.winner_user_id] : [])));
  const info = new Map<string, { name: string | null; phone: string | null }>();
  if (uids.length) {
    const { data: profs } = await sb.from("profiles").select("id, full_name, phone").in("id", uids);
    for (const p of profs ?? []) info.set(p.id as string, { name: (p.full_name as string) ?? null, phone: (p.phone as string) ?? null });
  }
  const who = (uid: string) => info.get(uid)?.name ?? "—";

  // signed receipts for ALL receipts (création + entrée)
  const signed = new Map<string, string>();
  await Promise.all(
    [...entry, ...fees].map(async (p) => {
      if (!p.receipt_url) return;
      const { data: s } = await sb.storage.from("receipts").createSignedUrl(p.receipt_url, 3600);
      if (s?.signedUrl) signed.set(p.receipt_url, s.signedUrl);
    }),
  );

  const toItem = (p: Pay): PaymentReviewItem => {
    const promosObj = (p.metadata as { promos?: Record<string, boolean> } | null)?.promos ?? null;
    return {
      id: p.id, userId: p.user_id, buyerName: who(p.user_id), buyerPhone: info.get(p.user_id)?.phone ?? null,
      kind: p.kind, kindLabel: KIND_LABEL[p.kind] ?? p.kind, provider: p.provider, amount: Number(p.amount),
      status: p.status, receiptUrl: p.receipt_url ? signed.get(p.receipt_url) ?? null : null, receiptPath: p.receipt_url,
      receiptUploadedAt: p.receipt_uploaded_at, adminNotes: p.admin_notes, reviewedAt: p.reviewed_at,
      auctionId: id, propertyId: propId, propertyTitle: propTitle, propertyGovernorate: propGov,
      promos: promosObj ? { homeFeatured: !!promosObj.home_featured, topListed: !!promosObj.top_listed, banner: !!promosObj.banner } : null,
    };
  };

  const feePending = fees.filter((p) => p.status === "pending_review").map(toItem);
  const entryPending = entry.filter((p) => p.status === "pending_review").map(toItem);
  const resolved = [...fees, ...entry].filter((p) => p.status !== "pending_review").map(toItem);

  const cautions: CautionRow[] = deposits.map((d) => ({
    id: d.id, bidder: who(d.user_id), amount: Number(d.amount),
    state: d.forfeited_at ? "forfeited" : d.refunded_at ? "refunded" : d.released_at ? "to_refund" : "locked",
    refundRef: d.refund_ref,
  }));

  const winnerName = a.winner_user_id ? who(a.winner_user_id) : null;

  return (
    <div>
      <Link href="/admin" className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-gold">
        <ChevronLeft className="size-3.5" /> Retour aux files
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="batta-gold-fill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider">
          <Gavel className="size-3" strokeWidth={2.5} /> {a.listing_type === "direct" ? "Offre directe" : "Enchère"}
        </span>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted ring-1 ring-border">{a.status}</span>
      </div>
      <h1 className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">{propTitle}</h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-gold" /> {propGov}</span>
        <span aria-hidden className="opacity-40">·</span>
        <span className="batta-tabular">Actuel <b className="text-foreground">{fmt(Number(a.current_price ?? a.opening_price))}</b></span>
        {winnerName && (<><span aria-hidden className="opacity-40">·</span><span className="inline-flex items-center gap-1 text-emerald-600"><Trophy className="size-3.5" /> {winnerName} · {fmt(Number(a.winner_amount ?? 0))}</span></>)}
        <Link href={`/auctions/${a.id}` as `/auctions/${string}`} className="inline-flex items-center gap-1 text-gold hover:underline"><ExternalLink className="size-3.5" /> Voir l&apos;annonce</Link>
      </div>

      <div className="mt-7 space-y-7">
        <Section icon={Building2} title="Reçus de création à traiter" count={feePending.length}>
          {feePending.length === 0 ? <Empty text="Aucun reçu de création en attente." /> : <PaymentsQueueList items={feePending} view="pending_review" />}
        </Section>

        <Section icon={Receipt} title="Paiements à traiter (caution · achat · solde)" count={entryPending.length}>
          {entryPending.length === 0 ? <Empty text="Aucun paiement d'entrée en attente." /> : <PaymentsQueueList items={entryPending} view="pending_review" />}
        </Section>

        <Section icon={Banknote} title="Cautions" count={cautions.length}>
          {cautions.length === 0 ? <Empty text="Aucune caution." /> : <CautionActions auctionId={id} deposits={cautions} />}
        </Section>

        {resolved.length > 0 && (
          <Section icon={Receipt} title="Reçus traités" count={resolved.length}>
            <PaymentsQueueList items={resolved} view="all" />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, count, children }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-foreground">
        <Icon className="size-4 text-gold" strokeWidth={2.2} />
        {title}
        <span className="batta-tabular rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted ring-1 ring-border">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[12px] text-muted">{text}</div>;
}
