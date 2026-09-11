"use client";

import { useMemo, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import {
  Wallet,
  FileText,
  ArrowRight,
  ChevronRight,
  Clock,
  AlertTriangle,
  MapPin,
  TrendingUp,
  ListFilter,
  X,
  Loader2,
  Home,
} from "lucide-react";

/**
 * Mes paiements — client half.
 *
 * WHAT CHANGED. This view was built for the auction product: a « Caution
 * bloquée » total, a « Cautions » tab, a caution-lifecycle badge (locked → to
 * refund → refunded / forfeited), and a « Reprendre » button that rebuilt a
 * checkout URL from `auctionId`. None of those can occur — cautions went with
 * auctions — and `auctionId` was always null, so a rejected listing fee showed
 * no way to try again at all. It now describes the five things a seller can
 * pay for, and sends a rejected one back to their annonces, where it is
 * re-submitted.
 */

/** A user-cancelled pending payment is stored as `failed` with this exact
 *  marker (see /api/payments/[id]/cancel) — shown as a neutral "Annulé", not
 *  as a failed payment to redo. */
const CANCELLED_NOTE = "Annulé par l'utilisateur";
function isCancelled(p: { status: string; adminNotes: string | null }): boolean {
  return p.status === "failed" && p.adminNotes === CANCELLED_NOTE;
}

export type PaymentVM = {
  id: string;
  kind: string;
  provider: string;
  amount: number;
  status: string;
  createdAt: string;
  adminNotes: string | null;
  /** Signed, time-limited URL for the uploaded receipt (private bucket). */
  receiptUrl: string | null;
  /** The annonce this payment was for, from `payments.metadata.listing_id`. */
  listingId: string | null;
  title: string | null;
  governorate: string | null;
  coverUrl: string | null;
};

export type PaymentsSummary = {
  actionCount: number;
  reviewCount: number;
  spentTotal: number;
};

const KIND_LABELS: Record<string, string> = {
  listing_fee: "Frais de publication",
  renewal: "Renouvellement",
  promo: "Mise en avant",
  listing_pack: "Pack d'annonces",
  badge: "Badge vendeur",
};

/** Kinds tied to one annonce — a rejected one is redone by re-submitting it. */
const LISTING_KINDS = new Set(["listing_fee", "renewal", "promo"]);

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Reçu à téléverser", tone: "mazed-tone-warn" },
  pending_review: { label: "Reçu en vérification", tone: "mazed-tone-warn" },
  captured: { label: "Payé", tone: "mazed-tone-ok" },
  refunded: { label: "Remboursé", tone: "bg-surface-2 text-muted ring-1 ring-border" },
  failed: { label: "Refusé", tone: "mazed-tone-bad" },
};

function providerLabel(provider: string): string {
  switch (provider) {
    case "d17":
      return "D17";
    case "bank_transfer":
      return "Virement";
    case "manual":
      return "Enregistré par l'admin";
    default:
      return provider;
  }
}

/** Where the primary action leads:
 *  - pending / pending_review → back into this payment's checkout
 *  - failed (listing-bound)   → the seller's annonces, to re-submit it */
function actionHref(p: PaymentVM): string | null {
  if (isCancelled(p)) return null;
  if (p.status === "pending" || p.status === "pending_review") {
    return `/payment/checkout?payment=${p.id}`;
  }
  if (p.status === "failed" && LISTING_KINDS.has(p.kind)) return "/account/listings";
  return null;
}

function actionLabel(p: PaymentVM): string {
  if (p.status === "pending") return "Téléverser le reçu";
  if (p.status === "pending_review") return "Voir / corriger le reçu";
  return "Soumettre à nouveau";
}

type FilterKey = "all" | "action" | "paid" | "refunded";

function matchesFilter(p: PaymentVM, key: FilterKey): boolean {
  switch (key) {
    case "all":
      return true;
    case "action":
      return (
        (p.status === "pending" || p.status === "pending_review" || p.status === "failed") &&
        !isCancelled(p)
      );
    case "paid":
      return p.status === "captured";
    case "refunded":
      return p.status === "refunded";
    default:
      return true;
  }
}

export function PaymentsClient({
  payments,
  summary,
  locale,
}: {
  payments: PaymentVM[];
  summary: PaymentsSummary;
  locale: string;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const router = useRouter();
  const { toast } = useToast();

  async function cancelPayment(id: string): Promise<boolean> {
    const res = await fetch(`/api/payments/${id}/cancel`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.detail ?? j.error ?? "Annulation impossible.", "error");
      return false;
    }
    toast("Paiement annulé.", "success");
    router.refresh();
    return true;
  }

  // Items that genuinely need the seller to act: upload a receipt or redo a
  // rejected payment. `pending_review` is informational, so it's excluded.
  const todo = useMemo(
    () =>
      payments.filter(
        (p) => p.status === "pending" || (p.status === "failed" && !isCancelled(p)),
      ),
    [payments],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, action: 0, paid: 0, refunded: 0 };
    for (const p of payments) {
      (Object.keys(c) as FilterKey[]).forEach((k) => {
        if (matchesFilter(p, k)) c[k] += 1;
      });
    }
    return c;
  }, [payments]);

  const visible = useMemo(() => payments.filter((p) => matchesFilter(p, filter)), [payments, filter]);

  // A tab with nothing in it is only offered when it is the one selected.
  const TABS: { key: FilterKey; label: string }[] = (
    [
      { key: "all", label: "Tout" },
      { key: "action", label: "À traiter" },
      { key: "paid", label: "Payés" },
      { key: "refunded", label: "Remboursés" },
    ] as { key: FilterKey; label: string }[]
  ).filter((t) => t.key === "all" || t.key === filter || counts[t.key] > 0);

  return (
    <div className="mt-6">
      {/* ── Summary — the three signals that matter, at a glance. ── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="À traiter"
          value={String(summary.actionCount)}
          Icon={AlertTriangle}
          tone={summary.actionCount > 0 ? "text-amber-700" : "text-foreground/50"}
          highlight={summary.actionCount > 0}
        />
        <StatCard
          label="Total dépensé"
          value={formatTND(summary.spentTotal, locale)}
          suffix="TND"
          Icon={TrendingUp}
          tone="text-foreground/70"
        />
        <StatCard
          label="En vérification"
          value={String(summary.reviewCount)}
          Icon={Clock}
          tone="text-foreground/70"
        />
      </div>

      {/* ── "À traiter" strip — receipts to upload + rejected payments to redo. ── */}
      {todo.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30">
          <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
            <AlertTriangle className="size-3.5 text-amber-700" strokeWidth={2.6} />
            <span className="text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-amber-800">
              À traiter
            </span>
            <span className="mazed-tabular ml-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-extrabold text-amber-800">
              {todo.length}
            </span>
          </div>
          <ul className="divide-y divide-amber-500/15">
            {todo.map((p) => {
              const href = actionHref(p);
              const inner = (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 transition hover:bg-amber-500/10">
                  <Thumb url={p.coverUrl} className="size-9 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-foreground">
                      {KIND_LABELS[p.kind] ?? p.kind}
                      {" · "}
                      <span className="mazed-tabular">{formatTND(p.amount, locale)} TND</span>
                    </div>
                    <div className="truncate text-[11px] font-semibold text-amber-800">
                      {p.status === "pending"
                        ? "Reçu à téléverser"
                        : p.adminNotes
                          ? `Refusé : ${p.adminNotes}`
                          : "Refusé — à soumettre de nouveau"}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-amber-700" strokeWidth={2.4} />
                </div>
              );
              return (
                <li key={p.id}>
                  {href ? <Link href={href as "/payment/checkout"}>{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Filter tabs ── */}
      <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:px-0">
        {TABS.map(({ key, label }) => {
          const on = filter === key;
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={on}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-all lg:text-[13px] ${
                on
                  ? "bg-foreground text-[var(--background)]"
                  : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground"
              }`}
            >
              {key === "all" && <ListFilter className="size-3.5" strokeWidth={2.5} />}
              {label}
              {count > 0 && (
                <span
                  className={`mazed-tabular ml-0.5 rounded-full px-1.5 text-[10px] font-extrabold ${
                    on ? "bg-white/20" : "bg-surface text-foreground/70"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Rows ── */}
      {visible.length === 0 ? (
        <div className="mazed-frame-gold relative mt-5 px-6 py-10 text-center">
          <Wallet className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">Aucun paiement dans cette catégorie.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {visible.map((p) => (
            <li key={p.id} id={`pay-${p.id}`}>
              <PaymentRow p={p} locale={locale} onCancel={cancelPayment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The annonce's cover, or a neutral house glyph — not an emoji. */
function Thumb({ url, className }: { url: string | null; className: string }) {
  return (
    <span className={`relative shrink-0 overflow-hidden bg-surface-2 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-muted">
          <Home className="size-4" strokeWidth={2} />
        </span>
      )}
    </span>
  );
}

function StatCard({
  label,
  value,
  suffix,
  Icon,
  tone,
  highlight = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  Icon: typeof Wallet;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-3.5 ring-1 lg:p-5 ${
        highlight ? "bg-amber-500/10 ring-amber-500/30" : "bg-surface ring-border"
      }`}
    >
      <span
        className={`inline-flex size-8 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-border lg:size-10 ${tone}`}
      >
        <Icon className="size-4 lg:size-5" strokeWidth={2.2} />
      </span>
      <div className="mazed-tabular mt-3 flex items-baseline gap-1 text-[18px] font-extrabold leading-none text-foreground lg:text-[24px]">
        {value}
        {suffix && <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">{suffix}</span>}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-muted lg:text-[12px]">{label}</div>
    </div>
  );
}

function PaymentRow({
  p,
  locale,
  onCancel,
}: {
  p: PaymentVM;
  locale: string;
  onCancel: (id: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelled = isCancelled(p);

  const badge = cancelled
    ? { label: "Annulé", tone: "bg-surface-2 text-muted ring-1 ring-border" }
    : STATUS[p.status] ?? { label: p.status, tone: "bg-surface-2 text-muted ring-1 ring-border" };

  const canResume =
    (p.status === "pending" || p.status === "pending_review" || p.status === "failed") && !cancelled;
  // Cancel is only offered before a receipt is uploaded. (The API enforces the
  // same rule.)
  const canCancel = p.status === "pending";
  const aHref = actionHref(p);
  const entityHref = p.listingId ? (`/annonces/${p.listingId}` as `/annonces/${string}`) : null;
  const showFooter = (canResume && aHref) || canCancel || p.receiptUrl || entityHref;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-border">
      <div className="flex items-start gap-3 p-4">
        {(p.coverUrl || p.title) && <Thumb url={p.coverUrl} className="size-14 rounded-xl" />}

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted">
            {KIND_LABELS[p.kind] ?? p.kind}
          </div>
          {p.title && (
            <div className="mt-0.5 truncate text-[11.5px] font-bold text-foreground">{p.title}</div>
          )}
          <div className="mazed-tabular mt-1 text-[18px] font-extrabold text-foreground">
            {formatTND(p.amount, locale)}{" "}
            <span className="text-[10px] font-bold uppercase text-muted">TND</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
            <span>
              {new Date(p.createdAt).toLocaleDateString(locale, {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span aria-hidden>·</span>
            <span>{providerLabel(p.provider)}</span>
            {p.governorate && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="size-3" strokeWidth={2} />
                  {p.governorate}
                </span>
              </>
            )}
          </div>

          {/* Rejection reason — inline so the seller knows what to fix. Hidden
              for user-cancelled rows (the "motif" would be our own marker). */}
          {p.status === "failed" && !cancelled && p.adminNotes && (
            <div className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-500/20">
              Motif du refus : {p.adminNotes}
            </div>
          )}
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${badge.tone}`}
        >
          {badge.label}
        </span>
      </div>

      {showFooter && (
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          {canResume && aHref && (
            <Link
              href={aHref as "/payment/checkout"}
              className="mazed-btn-luxe tap-target gap-1 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.12em]"
            >
              {actionLabel(p)}
              <ArrowRight className="size-3" strokeWidth={2.5} />
            </Link>
          )}

          {/* Cancel — only for pending (not-yet-paid) rows. Two-tap confirm. */}
          {canCancel &&
            (confirming ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await onCancel(p.id);
                    if (!ok) {
                      setBusy(false);
                      setConfirming(false);
                    }
                  }}
                  className="tap-target inline-flex items-center gap-1 rounded-full bg-[var(--danger)] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" strokeWidth={2.6} />}
                  Confirmer
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className="tap-target inline-flex items-center rounded-full px-2.5 py-1.5 text-[11px] font-bold text-muted hover:text-foreground disabled:opacity-50"
                >
                  Non
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="tap-target inline-flex items-center gap-1 rounded-full border border-[var(--accent-soft)] bg-[var(--accent-faint)] px-3 py-1.5 text-[11px] font-bold text-[var(--accent-deep)] transition hover:bg-[var(--accent)]/10"
              >
                <X className="size-3" strokeWidth={2.5} />
                Annuler
              </button>
            ))}
          {p.receiptUrl && (
            <a
              href={p.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-gold-soft/50"
            >
              <FileText className="size-3" strokeWidth={2} />
              Reçu
            </a>
          )}
          {entityHref && (
            <Link
              href={entityHref}
              className="tap-target ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-muted hover:text-foreground"
            >
              Voir l&apos;annonce
              <ChevronRight className="size-3.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
