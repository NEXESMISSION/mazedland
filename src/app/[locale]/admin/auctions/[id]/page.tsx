import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatTND } from "@/lib/utils";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import {
  ChevronLeft, Gavel, MapPin, FileText, Receipt, Banknote, Wallet,
  ExternalLink, Building2, Trophy,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KIND_LABEL: Record<string, string> = {
  listing_fee: "Frais de création", deposit_lock: "Caution", buy_now: "Achat immédiat",
  final_payment: "Paiement final", commission: "Commission", deposit_release: "Remboursement",
};
const PAY_TONE: Record<string, { label: string; tone: string }> = {
  pending_review: { label: "À vérifier", tone: "batta-tone-warn" },
  captured: { label: "Validé", tone: "batta-tone-ok" },
  failed: { label: "Refusé", tone: "batta-tone-bad" },
  pending: { label: "En attente", tone: "bg-surface-2 text-muted ring-1 ring-border" },
  cancelled: { label: "Annulé", tone: "bg-surface-2 text-muted ring-1 ring-border" },
};
const fmt = (n: number) => `${formatTND(n, "fr")} TND`;

/**
 * Admin per-auction drill-down — one screen with EVERY receipt/payment tied
 * to a single lot: the creation fee, all entry payments (caution / achat /
 * solde), and every caution with its refund state. Reached by clicking an
 * auction group header in any queue.
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
    id: string; type: string; listing_type: string; status: string;
    opening_price: number; current_price: number | null;
    winner_user_id: string | null; winner_amount: number | null; ends_at: string;
    property: { id: string; title: string; governorate: string; owner_id: string; status: string } | null;
  };
  const propId = a.property?.id ?? null;

  // ── all payments tied to this lot (entry by auction_id + creation fee by property_id) ──
  const [entryRes, feeRes, depRes] = await Promise.all([
    sb.from("payments")
      .select("id, user_id, kind, provider, amount, status, receipt_url, receipt_uploaded_at, admin_notes")
      .eq("auction_id", id).order("receipt_uploaded_at", { ascending: false }),
    propId
      ? sb.from("payments")
          .select("id, user_id, kind, provider, amount, status, receipt_url, receipt_uploaded_at, admin_notes")
          .eq("property_id", propId).eq("kind", "listing_fee").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    sb.from("auction_deposits")
      .select("id, user_id, amount, released_at, refunded_at, forfeited_at, refund_ref, payment_id")
      .eq("auction_id", id).order("created_at", { ascending: true }),
  ]);

  type Pay = { id: string; user_id: string; kind: string; provider: string; amount: number; status: string; receipt_url: string | null; receipt_uploaded_at: string | null; admin_notes: string | null };
  const entry = (entryRes.data ?? []) as Pay[];
  const fees = (feeRes.data ?? []) as Pay[];
  type Dep = { id: string; user_id: string; amount: number; released_at: string | null; refunded_at: string | null; forfeited_at: string | null; refund_ref: string | null; payment_id: string | null };
  const deposits = (depRes.data ?? []) as Dep[];

  // names
  const uids = Array.from(new Set([...entry, ...fees, ...deposits].map((r) => r.user_id).concat(a.winner_user_id ?? [])));
  const names = new Map<string, string>();
  if (uids.length) {
    const { data: profs } = await sb.from("profiles").select("id, full_name").in("id", uids);
    for (const p of profs ?? []) if (p.full_name) names.set(p.id as string, p.full_name as string);
  }
  const who = (uid: string) => names.get(uid) ?? "—";

  // sign receipts (payments only)
  const signed = new Map<string, string>();
  const allPaths = [...entry, ...fees].map((p) => p.receipt_url).filter(Boolean) as string[];
  await Promise.all(allPaths.map(async (path) => {
    const { data: s } = await sb.storage.from("receipts").createSignedUrl(path, 3600);
    if (s?.signedUrl) signed.set(path, s.signedUrl);
  }));

  const depState = (d: Dep) =>
    d.forfeited_at ? { label: "Confisquée", tone: "batta-tone-bad" }
    : d.refunded_at ? { label: "Remboursée", tone: "batta-tone-ok" }
    : d.released_at ? { label: "À rembourser", tone: "batta-tone-warn" }
    : { label: "Bloquée", tone: "bg-surface-2 text-muted ring-1 ring-border" };

  const winnerName = a.winner_user_id ? who(a.winner_user_id) : null;

  return (
    <div>
      <Link href="/admin/properties" className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-gold">
        <ChevronLeft className="size-3.5" /> Retour aux files
      </Link>

      {/* Lot header */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="batta-gold-fill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider">
          <Gavel className="size-3" strokeWidth={2.5} /> {a.listing_type === "direct" ? "Offre directe" : "Enchère"}
        </span>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted ring-1 ring-border">
          {a.status}
        </span>
      </div>
      <h1 className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">{a.property?.title ?? "—"}</h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-gold" /> {a.property?.governorate}</span>
        <span aria-hidden className="opacity-40">·</span>
        <span className="batta-tabular">Actuel <b className="text-foreground">{fmt(Number(a.current_price ?? a.opening_price))}</b></span>
        {winnerName && (
          <>
            <span aria-hidden className="opacity-40">·</span>
            <span className="inline-flex items-center gap-1 text-emerald-600"><Trophy className="size-3.5" /> {winnerName} · {fmt(Number(a.winner_amount ?? 0))}</span>
          </>
        )}
        <Link href={`/auctions/${a.id}` as `/auctions/${string}`} className="inline-flex items-center gap-1 text-gold hover:underline">
          <ExternalLink className="size-3.5" /> Voir l&apos;annonce
        </Link>
      </div>

      <div className="mt-7 space-y-7">
        {/* CRÉATION */}
        <Section icon={Building2} title="Reçus de création" count={fees.length}>
          {fees.length === 0 ? <Empty text="Aucun reçu de création." /> : (
            <ul className="space-y-2">
              {fees.map((p) => <PayRow key={p.id} p={p} who={who} signed={signed} />)}
            </ul>
          )}
        </Section>

        {/* PAIEMENTS (entrée) */}
        <Section icon={Receipt} title="Paiements (caution · achat · solde)" count={entry.length}>
          {entry.length === 0 ? <Empty text="Aucun paiement d'entrée." /> : (
            <ul className="space-y-2">
              {entry.map((p) => <PayRow key={p.id} p={p} who={who} signed={signed} />)}
            </ul>
          )}
        </Section>

        {/* CAUTIONS */}
        <Section icon={Banknote} title="Cautions" count={deposits.length}>
          {deposits.length === 0 ? <Empty text="Aucune caution." /> : (
            <ul className="space-y-2">
              {deposits.map((d) => {
                const st = depState(d);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3.5 ring-1 ring-border">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-foreground">{who(d.user_id)}</div>
                      <div className="batta-tabular mt-0.5 text-[12px] text-muted">{fmt(Number(d.amount))}{d.refund_ref ? ` · réf. ${d.refund_ref}` : ""}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${st.tone}`}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
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

function PayRow({ p, who, signed }: {
  p: { id: string; user_id: string; kind: string; provider: string; amount: number; status: string; receipt_url: string | null; admin_notes: string | null };
  who: (uid: string) => string;
  signed: Map<string, string>;
}) {
  const tone = PAY_TONE[p.status] ?? { label: p.status, tone: "bg-surface-2 text-muted ring-1 ring-border" };
  const url = p.receipt_url ? signed.get(p.receipt_url) ?? null : null;
  const isPdf = (p.receipt_url ?? "").toLowerCase().endsWith(".pdf");
  return (
    <li className="flex items-center gap-3 rounded-xl bg-surface p-3.5 ring-1 ring-border">
      {url && !isPdf ? (
        <ImageLightbox src={url} alt="Reçu" triggerClassName="relative size-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Reçu" className="size-full object-cover" />
        </ImageLightbox>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer" className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 ring-1 ring-border text-gold"><FileText className="size-5" /></a>
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 ring-1 ring-border text-muted"><Wallet className="size-5" /></span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{KIND_LABEL[p.kind] ?? p.kind}</div>
        <div className="text-[13px] font-bold text-foreground">{who(p.user_id)}</div>
        <div className="batta-tabular text-[12px] text-muted">{fmt(Number(p.amount))} · {p.provider === "d17" ? "D17" : "Virement"}</div>
        {p.status === "failed" && p.admin_notes && (
          <div className="batta-tone-bad mt-1 inline-block rounded px-1.5 py-0.5 text-[10.5px]">{p.admin_notes}</div>
        )}
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${tone.tone}`}>{tone.label}</span>
    </li>
  );
}
