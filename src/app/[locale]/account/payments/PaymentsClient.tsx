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
  RefreshCw,
  CheckCircle2,
  ShieldAlert,
  Clock,
  AlertTriangle,
  MapPin,
  TrendingUp,
  ListFilter,
  X,
  Loader2,
} from "lucide-react";

/** A user-cancelled pending payment is stored as `failed` with this exact
 *  marker (see /api/payments/[id]/cancel) — we display it as a neutral
 *  "Annulé", not as a failed payment to redo. */
const CANCELLED_NOTE = "Annulé par l'utilisateur";
function isCancelled(p: { status: string; adminNotes: string | null }): boolean {
  return p.status === "failed" && p.adminNotes === CANCELLED_NOTE;
}

export type DepositLifecycle = "locked" | "to_refund" | "refunded" | "forfeited";

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
  auctionId: string | null;
  title: string | null;
  governorate: string | null;
  coverUrl: string | null;
  /** Real caution lifecycle for `deposit_lock` rows, derived from auction_deposits. */
  depositStatus: DepositLifecycle | null;
};

export type PaymentsSummary = {
  actionCount: number;
  reviewCount: number;
  lockedTotal: number;
  spentTotal: number;
  refundedTotal: number;
};

const KIND_LABELS: Record<string, string> = {
  deposit_lock: "Caution de participation",
  buy_now: "Achat direct",
  final_payment: "Paiement final",
  commission: "Commission",
  inspection_fee: "Frais d'inspection",
  subscription: "Abonnement",
  deposit_release: "Remboursement de caution",
  listing_fee: "Frais d'annonce",
};

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Reçu à téléverser", tone: "batta-tone-warn" },
  pending_review: { label: "Reçu en vérification", tone: "batta-tone-warn" },
  captured: { label: "Payé", tone: "batta-tone-ok" },
  refunded: { label: "Remboursé", tone: "bg-surface-2 text-muted ring-1 ring-border" },
  failed: { label: "Refusé", tone: "batta-tone-bad" },
};

/** For a `deposit_lock`, the right-hand badge reflects where the money
 *  actually is, not the flat payment status. */
const DEPOSIT_BADGE: Record<DepositLifecycle, { label: string; tone: string }> = {
  locked: { label: "Caution bloquée", tone: "bg-gold-faint text-gold-bright ring-1 ring-gold/30" },
  to_refund: { label: "Remb. en cours", tone: "batta-tone-warn" },
  refunded: { label: "Remboursée", tone: "batta-tone-ok" },
  forfeited: { label: "Caution saisie", tone: "batta-tone-bad" },
};

/** db kind → checkout `type` param, so a rejected payment can be redone
 *  through the same entry that created it (inspection_fee has no type). */
const KIND_TO_CHECKOUT: Record<string, string> = {
  deposit_lock: "deposit",
  buy_now: "buy_now",
  final_payment: "final_payment",
  listing_fee: "listing_fee",
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

/** Where the primary action button leads:
 *  - pending / pending_review → resume the existing checkout (upload / fix receipt)
 *  - failed → re-initiate through the typed checkout entry (a new pending row)  */
function actionHref(p: PaymentVM): string | null {
  if (isCancelled(p)) return null;
  if (p.status === "pending" || p.status === "pending_review") {
    return `/payment/checkout?payment=${p.id}`;
  }
  if (p.status === "failed") {
    const type = KIND_TO_CHECKOUT[p.kind];
    if (type && p.auctionId) return `/payment/checkout?type=${type}&auction=${p.auctionId}`;
    return p.auctionId ? `/auctions/${p.auctionId}` : null;
  }
  return null;
}

function actionLabel(p: PaymentVM): string {
  if (p.status === "pending") return "Téléverser le reçu";
  if (p.status === "pending_review") return "Voir / corriger le reçu";
  return "Reprendre le paiement";
}

type FilterKey = "all" | "action" | "deposits" | "purchases" | "refunds";

const DEPOSIT_KINDS = new Set(["deposit_lock", "deposit_release"]);
const PURCHASE_KINDS = new Set(["buy_now", "final_payment", "inspection_fee", "listing_fee"]);

function matchesFilter(p: PaymentVM, key: FilterKey): boolean {
  switch (key) {
    case "all":
      return true;
    case "action":
      return (
        (p.status === "pending" || p.status === "pending_review" || p.status === "failed") &&
        !isCancelled(p)
      );
    case "deposits":
      return DEPOSIT_KINDS.has(p.kind);
    case "purchases":
      return PURCHASE_KINDS.has(p.kind);
    case "refunds":
      return (
        p.status === "refunded" ||
        p.kind === "deposit_release" ||
        p.depositStatus === "refunded" ||
        p.depositStatus === "to_refund"
      );
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

  // Items that genuinely need the buyer to act: upload a receipt or redo a
  // rejected payment. `pending_review` is informational, so it's excluded.
  const todo = useMemo(
    () =>
      payments.filter(
        (p) => p.status === "pending" || (p.status === "failed" && !isCancelled(p)),
      ),
    [payments],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, action: 0, deposits: 0, purchases: 0, refunds: 0 };
    for (const p of payments) {
      (Object.keys(c) as FilterKey[]).forEach((k) => {
        if (matchesFilter(p, k)) c[k] += 1;
      });
    }
    return c;
  }, [payments]);

  const visible = useMemo(() => payments.filter((p) => matchesFilter(p, filter)), [payments, filter]);

  const TABS: { key: FilterKey; label: string }[] = [
    { key: "all", label: "Tout" },
    { key: "action", label: "À traiter" },
    { key: "deposits", label: "Cautions" },
    { key: "purchases", label: "Achats & frais" },
    { key: "refunds", label: "Remboursements" },
  ];

  return (
    <div className="mt-6">
      {/* ── Summary cards — the four signals that matter, at a glance. ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="À traiter"
          value={String(summary.actionCount)}
          Icon={AlertTriangle}
          tone={summary.actionCount > 0 ? "text-amber-600" : "text-foreground/50"}
          highlight={summary.actionCount > 0}
        />
        <StatCard
          label="Caution bloquée"
          value={formatTND(summary.lockedTotal, locale)}
          suffix="TND"
          Icon={Wallet}
          tone="text-gold"
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
            <AlertTriangle className="size-3.5 text-amber-600" strokeWidth={2.6} />
            <span className="text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-amber-700">
              À traiter
            </span>
            <span className="batta-tabular ml-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-extrabold text-amber-700">
              {todo.length}
            </span>
          </div>
          <ul className="divide-y divide-amber-500/15">
            {todo.map((p) => {
              const href = actionHref(p);
              const inner = (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 transition hover:bg-amber-500/10">
                  <span className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                    {p.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.coverUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-sm text-foreground/20">
                        🏛️
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-foreground">
                      {KIND_LABELS[p.kind] ?? p.kind}
                      {" · "}
                      <span className="batta-tabular">{formatTND(p.amount, locale)} TND</span>
                    </div>
                    <div className="truncate text-[11px] font-semibold text-amber-700">
                      {p.status === "pending"
                        ? "Reçu à téléverser"
                        : p.adminNotes
                          ? `Refusé : ${p.adminNotes}`
                          : "Refusé — à reprendre"}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-amber-600" strokeWidth={2.4} />
                </div>
              );
              return (
                <li key={p.id}>
                  {href ? (
                    <Link href={href as "/payment/checkout"}>{inner}</Link>
                  ) : (
                    inner
                  )}
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
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-all lg:text-[13px] ${
                on
                  ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
                  : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground"
              }`}
            >
              {key === "all" && <ListFilter className="size-3.5" strokeWidth={2.5} />}
              {label}
              {count > 0 && (
                <span
                  className={`batta-tabular ml-0.5 rounded-full px-1.5 text-[10px] font-extrabold ${
                    on ? "bg-white/25" : "bg-surface text-foreground/70"
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
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center">
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
      className={`rounded-2xl p-4 ring-1 lg:p-5 ${
        highlight ? "bg-amber-500/10 ring-amber-500/30" : "bg-surface ring-border"
      }`}
    >
      <span
        className={`inline-flex size-9 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-border lg:size-10 ${tone}`}
      >
        <Icon className="size-4 lg:size-5" strokeWidth={2.2} />
      </span>
      <div className="batta-tabular mt-3 flex items-baseline gap-1 text-[20px] font-extrabold leading-none text-foreground lg:text-[24px]">
        {value}
        {suffix && <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">{suffix}</span>}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-muted lg:text-[12px]">{label}</div>
    </div>
  );
}

/** Caution lifecycle chip (shown in the chips row for deposit_release / refund context). */
function lifecycleChip(status: DepositLifecycle) {
  const map = {
    locked: { Icon: Wallet, label: "Bloquée" },
    to_refund: { Icon: RefreshCw, label: "Remboursement en cours" },
    refunded: { Icon: CheckCircle2, label: "Remboursée" },
    forfeited: { Icon: ShieldAlert, label: "Saisie" },
  } as const;
  return map[status];
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

  // For a deposit, the badge tells the user where the caution is now.
  const badge = cancelled
    ? { label: "Annulé", tone: "bg-surface-2 text-muted ring-1 ring-border" }
    : p.kind === "deposit_lock" && p.depositStatus
      ? DEPOSIT_BADGE[p.depositStatus]
      : STATUS[p.status] ?? { label: p.status, tone: "bg-surface-2 text-muted ring-1 ring-border" };

  const canResume =
    (p.status === "pending" || p.status === "pending_review" || p.status === "failed") && !cancelled;
  // Cancel is only offered before a receipt is uploaded — i.e. the "À traiter"
  // rows the user hasn't acted on yet. (The API enforces the same rule.)
  const canCancel = p.status === "pending";
  const aHref = actionHref(p);
  const entityHref = p.auctionId ? (`/auctions/${p.auctionId}` as `/auctions/${string}`) : null;
  const showFooter = (canResume && aHref) || canCancel || p.receiptUrl || entityHref;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-border">
      <div className="flex items-start gap-3 p-4">
        {/* Cover thumbnail when a property/auction is linked. */}
        {(p.coverUrl || p.title) && (
          <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
            {p.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-lg text-foreground/20">
                🏛️
              </span>
            )}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold">
            {KIND_LABELS[p.kind] ?? p.kind}
          </div>
          {p.title && (
            <div className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] font-bold text-foreground">
              <span className="truncate">{p.title}</span>
            </div>
          )}
          <div className="batta-tabular mt-1 text-[18px] font-extrabold text-foreground">
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

          {/* Rejection reason — surfaced inline so the user knows what to fix.
              Hidden for user-cancelled rows (the "motif" would just be our
              own marker). */}
          {p.status === "failed" && !cancelled && p.adminNotes && (
            <div className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20">
              Motif du refus : {p.adminNotes}
            </div>
          )}

          {/* Refund lifecycle hint for deposits flagged / refunded. */}
          {p.kind === "deposit_lock" &&
            (p.depositStatus === "to_refund" || p.depositStatus === "refunded") && (
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted">
                {(() => {
                  const { Icon, label } = lifecycleChip(p.depositStatus);
                  return (
                    <>
                      <Icon className="size-3 text-gold" strokeWidth={2.2} />
                      {label} · {formatTND(p.amount, locale)} TND
                    </>
                  );
                })()}
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
              className="batta-gold-fill tap-target inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] shadow-[var(--shadow-gold)]"
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
              <FileText className="size-3 text-gold" strokeWidth={2} />
              Reçu
            </a>
          )}
          {entityHref && (
            <Link
              href={entityHref}
              className="tap-target ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-muted hover:text-gold-bright"
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
