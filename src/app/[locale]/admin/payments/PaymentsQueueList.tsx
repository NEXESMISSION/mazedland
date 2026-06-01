"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Check,
  X,
  Loader2,
  ExternalLink,
  Building2,
  Smartphone,
  FileText,
  AlertTriangle,
  Star,
  ArrowUpToLine,
  Megaphone,
  HandCoins,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

const DURATION_OPTIONS = [7, 30, 90] as const;
type PromoKey = "home_featured" | "top_listed" | "banner";

export type PaymentReviewItem = {
  id: string;
  userId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  kind: string;
  kindLabel: string;
  provider: string;
  amount: number;
  status: string;
  receiptUrl: string | null;
  receiptPath: string | null;
  receiptUploadedAt: string | null;
  adminNotes: string | null;
  reviewedAt: string | null;
  auctionId: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  propertyGovernorate: string | null;
  /** Only set when kind === 'listing_fee' — which promos the seller picked. */
  promos: { homeFeatured: boolean; topListed: boolean; banner: boolean } | null;
};

export function PaymentsQueueList({
  items,
  view,
  hideGroupHeader = false,
}: {
  items: PaymentReviewItem[];
  view: string;
  /** On the per-auction page the lot is already the page title, so the
   *  per-group header band just repeats it — hide it there. */
  hideGroupHeader?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [acceptingListing, setAcceptingListing] =
    useState<PaymentReviewItem | null>(null);
  const [durations, setDurations] = useState<Record<PromoKey, number>>({
    home_featured: 30,
    top_listed: 30,
    banner: 30,
  });

  // Group receipts BY AUCTION (fallback: by property, then "Sans annonce")
  // so each lot's payments are managed together instead of one flat list.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; title: string; gov: string; total: number; items: PaymentReviewItem[] }
    >();
    for (const it of items) {
      const key = it.auctionId ?? it.propertyId ?? "autres";
      const g = map.get(key) ?? {
        key,
        title: it.propertyTitle ?? "Sans annonce",
        gov: it.propertyGovernorate ?? "",
        total: 0,
        items: [],
      };
      g.items.push(it);
      g.total += it.amount;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [items]);

  async function decide(
    item: PaymentReviewItem,
    verdict: "captured" | "failed",
    notes?: string,
    durationsOverride?: Record<PromoKey, number>,
  ) {
    setBusy(item.id);
    try {
      const res = await fetch(`/api/admin/payments/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict,
          notes,
          durations: durationsOverride,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.detail ?? data.error ?? "Action échouée.", "error");
        return;
      }
      toast(
        verdict === "captured" ? "Paiement validé." : "Paiement refusé.",
        verdict === "captured" ? "success" : "warning",
      );
      router.refresh();
    } finally {
      setBusy(null);
      setAcceptingListing(null);
    }
  }

  function openAcceptListing(item: PaymentReviewItem) {
    setAcceptingListing(item);
    setDurations({
      home_featured: item.promos?.homeFeatured ? 30 : 0,
      top_listed: item.promos?.topListed ? 30 : 0,
      banner: item.promos?.banner ? 30 : 0,
    });
  }

  function onListingAccept(item: PaymentReviewItem) {
    if (item.kind === "listing_fee") {
      openAcceptListing(item);
    } else {
      decide(item, "captured");
    }
  }

  return (
    <>
      {/* Mobile: vertical card stack. Desktop: 2-up grid so the admin
          sees more receipts at a glance without scrolling card-by-
          card. Above 1400px we go to 3-up. */}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key}>
            {!hideGroupHeader && (
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
                {g.key !== "autres" ? (
                  <Link
                    href={`/admin/auctions/${g.key}`}
                    className="group/h inline-flex min-w-0 items-center gap-1.5 text-[13.5px] font-bold text-foreground hover:text-[var(--gold)]"
                  >
                    <Building2 className="size-3.5 shrink-0 text-[var(--gold)]" strokeWidth={2.2} />
                    <span className="truncate">{g.title}</span>
                    {g.gov && <span className="text-[11px] font-normal text-[var(--foreground-muted)]">· {g.gov}</span>}
                    <ExternalLink className="size-3 shrink-0 opacity-0 transition group-hover/h:opacity-100" />
                  </Link>
                ) : (
                  <div className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] font-bold text-foreground">
                    <Building2 className="size-3.5 shrink-0 text-[var(--gold)]" strokeWidth={2.2} />
                    <span className="truncate">{g.title}</span>
                  </div>
                )}
                <div className="batta-tabular text-[11px] text-[var(--foreground-muted)]">
                  {g.items.length} reçu{g.items.length > 1 ? "s" : ""} ·{" "}
                  {g.total.toLocaleString("fr-FR")} TND
                </div>
              </div>
            )}
            <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3">
              {g.items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]"
                >
            {/* Header — buyer + amount */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--gold)]">
                  {item.kindLabel}
                </div>
                <div className="mt-0.5 text-[14px] font-bold text-foreground">
                  {item.buyerName ?? "Acheteur"}
                </div>
                {item.buyerPhone && (
                  <div className="text-[11px] text-[var(--foreground-muted)] mt-0.5">
                    {item.buyerPhone}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="batta-tabular text-[20px] font-extrabold text-[var(--gold)]">
                  {item.amount.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  <span className="text-[10px] font-bold uppercase text-[var(--foreground-muted)]">
                    TND
                  </span>
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
                  {item.provider === "d17" ? (
                    <><Smartphone className="h-3 w-3" /> D17</>
                  ) : item.provider === "manual" ? (
                    <><HandCoins className="h-3 w-3" /> Manuel</>
                  ) : (
                    <><Building2 className="h-3 w-3" /> Virement</>
                  )}
                </div>
              </div>
            </div>

            {/* Property context */}
            {item.propertyTitle && (
              <a
                href={
                  item.propertyId
                    ? `/admin/properties/${item.propertyId}`
                    : item.auctionId
                      ? `/auctions/${item.auctionId}`
                      : "#"
                }
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--surface-2)]/60 px-2.5 py-2 text-[12px] hover:bg-[var(--surface-2)]"
              >
                <span className="text-[var(--foreground-muted)]">Annonce :</span>
                <span className="font-semibold truncate flex-1">
                  {item.propertyTitle}
                </span>
                <ExternalLink className="h-3 w-3 text-[var(--foreground-muted)]" />
              </a>
            )}

            {/* Promotions picked by the seller (listing_fee only) */}
            {item.kind === "listing_fee" && item.promos && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.promos.homeFeatured && (
                  <PromoChip icon={<Star className="h-3 w-3" />} label="Accueil" />
                )}
                {item.promos.topListed && (
                  <PromoChip
                    icon={<ArrowUpToLine className="h-3 w-3" />}
                    label="Top recherche"
                  />
                )}
                {item.promos.banner && (
                  <PromoChip icon={<Megaphone className="h-3 w-3" />} label="Bannière" />
                )}
                {!item.promos.homeFeatured &&
                  !item.promos.topListed &&
                  !item.promos.banner && (
                    <span className="text-[10.5px] text-[var(--foreground-muted)] italic">
                      Pas d&apos;option payante.
                    </span>
                  )}
              </div>
            )}

            {/* Receipt preview */}
            {item.receiptUrl ? (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)] mb-1.5">
                  Reçu téléversé
                </div>
                <ReceiptPreview url={item.receiptUrl} path={item.receiptPath ?? ""} />
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-900 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Aucun reçu téléversé pour ce paiement.
              </div>
            )}

            {/* Decision footer */}
            {view === "pending_review" ? (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy === item.id || !item.receiptUrl}
                  onClick={() => onListingAccept(item)}
                  className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--gold)] text-white font-bold text-[13px] hover:bg-[var(--gold-bright)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy === item.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  Valider
                </button>
                <Link
                  href={`/admin/payments/${item.id}/reject`}
                  className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px] hover:border-red-300 hover:text-red-700"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                  Refuser
                </Link>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-[var(--foreground-muted)]">
                {item.status === "captured" && (
                  <span className="inline-flex items-center gap-1 text-[var(--gold)] font-semibold">
                    <Check className="h-3 w-3" />
                    Validé
                    {item.reviewedAt && ` · ${formatDate(item.reviewedAt)}`}
                  </span>
                )}
                {item.status === "failed" && (
                  <div>
                    <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                      <X className="h-3 w-3" />
                      Refusé
                      {item.reviewedAt && ` · ${formatDate(item.reviewedAt)}`}
                    </span>
                    {item.adminNotes && (
                      <div className="mt-1.5 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-red-900">
                        <strong className="font-bold">Motif : </strong>
                        {item.adminNotes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Listing-fee accept modal — admin picks promo durations */}
      {acceptingListing && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => !busy && setAcceptingListing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-foreground">
              Valider l&apos;annonce
            </h3>
            <p className="mt-1 text-[12px] text-[var(--foreground-muted)] leading-relaxed">
              L&apos;annonce passe en ligne. Choisissez la durée de chaque
              option achetée (0 = ne pas activer).
            </p>

            <div className="mt-3 space-y-2.5">
              {acceptingListing.promos?.homeFeatured && (
                <DurationRow
                  icon={<Star className="h-3.5 w-3.5" />}
                  label="Mise en avant accueil"
                  value={durations.home_featured}
                  onChange={(v) =>
                    setDurations((d) => ({ ...d, home_featured: v }))
                  }
                />
              )}
              {acceptingListing.promos?.topListed && (
                <DurationRow
                  icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
                  label="Top recherche"
                  value={durations.top_listed}
                  onChange={(v) =>
                    setDurations((d) => ({ ...d, top_listed: v }))
                  }
                />
              )}
              {acceptingListing.promos?.banner && (
                <DurationRow
                  icon={<Megaphone className="h-3.5 w-3.5" />}
                  label="Bannière d'accueil"
                  value={durations.banner}
                  onChange={(v) => setDurations((d) => ({ ...d, banner: v }))}
                />
              )}
              {!acceptingListing.promos?.homeFeatured &&
                !acceptingListing.promos?.topListed &&
                !acceptingListing.promos?.banner && (
                  <p className="rounded-lg bg-[var(--surface-2)]/40 px-3 py-2 text-[12px] text-[var(--foreground-muted)]">
                    Aucune option promotionnelle sélectionnée. L&apos;annonce
                    sera simplement publiée.
                  </p>
                )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={busy === acceptingListing.id}
                onClick={() => setAcceptingListing(null)}
                className="flex-1 h-10 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px]"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy === acceptingListing.id}
                onClick={() =>
                  decide(acceptingListing, "captured", undefined, durations)
                }
                className="flex-1 h-10 rounded-[var(--radius)] bg-[var(--gold)] text-white font-bold text-[13px] hover:bg-[var(--gold-bright)] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                {busy === acceptingListing.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                )}
                Valider &amp; publier
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

function PromoChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--gold-faint)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--gold)] ring-1 ring-[var(--gold)]/25">
      {icon}
      {label}
    </span>
  );
}

function DurationRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg bg-[var(--surface-2)]/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
        <span className="text-[var(--gold)]">{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex gap-1.5">
        {DURATION_OPTIONS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onChange(days)}
            className={
              "flex-1 h-8 rounded-full text-[11px] font-bold transition " +
              (value === days
                ? "bg-[var(--gold)] text-white"
                : "bg-[var(--surface)] text-foreground ring-1 ring-[var(--border)] hover:ring-[var(--gold-soft)]")
            }
          >
            {days} j
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(0)}
          className={
            "flex-1 h-8 rounded-full text-[11px] font-bold transition " +
            (value === 0
              ? "bg-[var(--surface-2)] text-foreground ring-1 ring-[var(--border)]"
              : "bg-[var(--surface)] text-[var(--foreground-muted)] ring-1 ring-[var(--border)] hover:ring-[var(--gold-soft)]")
          }
        >
          0
        </button>
      </div>
    </div>
  );
}

function ReceiptPreview({ url, path }: { url: string; path: string }) {
  const isPdf = path.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-2.5 text-[13px] font-semibold hover:border-[var(--gold-soft)]"
      >
        <FileText className="h-4 w-4 text-[var(--gold)]" />
        Ouvrir le PDF du reçu
        <ExternalLink className="h-3 w-3 text-[var(--foreground-muted)]" />
      </a>
    );
  }
  return (
    <ImageLightbox
      src={url}
      alt="Reçu"
      triggerClassName="relative block aspect-video w-full max-w-md overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:ring-2 hover:ring-[var(--gold-soft)]"
    >
      <Image
        src={url}
        alt="Reçu"
        fill
        sizes="(max-width: 600px) 100vw, 400px"
        className="object-contain"
        unoptimized
      />
    </ImageLightbox>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
