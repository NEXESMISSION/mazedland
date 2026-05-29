"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import { LiveTimer } from "@/components/landing/LiveTimer";
import {
  Gavel,
  History,
  Heart,
  MapPin,
  Clock,
  Wallet,
  RefreshCw,
  CheckCircle2,
  ShieldAlert,
  Search,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

export type DepositStatus =
  | "free"
  | "locked"
  | "to_refund"
  | "refunded"
  | "forfeited";

export type ActivityItem = {
  auctionId: string;
  title: string;
  governorate: string;
  coverUrl: string | null;
  status: string;
  price: number;
  myBid: number | null;
  startsAt: string | null;
  endsAt: string;
  deposit?: { amount: number; status: DepositStatus } | null;
  /** Caution paid but not yet captured — awaiting receipt or admin review. */
  pending?: { kind: "receipt" | "review"; paymentId: string } | null;
};

/** The three buyer-facing groups the page now shows. */
type TabKey = "enCours" | "terminees" | "favoris";
/** Legacy bucket keys still used by deep links / redirects (?tab=…). */
type LegacyTabKey =
  | "enCours"
  | "enAttente"
  | "gagnees"
  | "participees"
  | "favoris";

/** Map an old deep-link bucket onto the new three-tab layout. */
const LEGACY_TO_TAB: Record<LegacyTabKey, TabKey> = {
  enCours: "enCours",
  enAttente: "enCours",
  gagnees: "terminees",
  participees: "terminees",
  favoris: "favoris",
};

const TABS: { key: TabKey; label: string; icon: typeof Gavel }[] = [
  { key: "enCours", label: "En cours", icon: Gavel },
  { key: "terminees", label: "Terminées", icon: History },
  { key: "favoris", label: "Favoris", icon: Heart },
];

const EMPTY: Record<TabKey, { icon: typeof Gavel; text: string }> = {
  enCours: { icon: Gavel, text: "Aucune enchère en cours. Réservez votre place avant l'ouverture." },
  terminees: { icon: History, text: "Rien de terminé pour l'instant. Vos acquisitions et participations passées apparaîtront ici." },
  favoris: { icon: Heart, text: "Aucun favori. Touchez le cœur sur une annonce pour la suivre." },
};

/** Sort the merged "En cours" list so the most time-sensitive rows lead:
 *  live auctions, then cautions you still owe a receipt for, then
 *  upcoming ones, then cautions waiting on an admin. */
function enCoursRank(item: ActivityItem): number {
  if (item.status === "live" || item.status === "extending") return 0;
  if (item.pending?.kind === "receipt") return 1;
  if (item.status === "scheduled") return 2;
  if (item.pending?.kind === "review") return 3;
  return 4;
}

/** Status → short French label + tone classes for the corner pill. */
function statusBadge(status: string): { label: string; tone: string } {
  switch (status) {
    case "live":
    case "extending":
      return { label: "En direct", tone: "bg-red-500 text-white" };
    case "scheduled":
      return { label: "À venir", tone: "bg-gold-faint text-gold-bright ring-1 ring-gold/30" };
    case "ended_sold":
    case "awarded":
    case "sixth_offer_window":
      return { label: "Adjugée", tone: "batta-tone-ok" };
    case "ended_unsold":
      return { label: "Invendue", tone: "bg-surface-2 text-muted ring-1 ring-border" };
    case "cancelled":
      return { label: "Annulée", tone: "bg-surface-2 text-muted ring-1 ring-border" };
    default:
      return { label: "Terminée", tone: "bg-surface-2 text-muted ring-1 ring-border" };
  }
}


/** Caution lifecycle → chip (icon + label + tone). Free entries get a
 *  quiet "gratuite" chip; everything else carries the amount. */
function DepositChip({
  deposit,
  locale,
}: {
  deposit: NonNullable<ActivityItem["deposit"]>;
  locale: string;
}) {
  const amount = formatTND(deposit.amount, locale);
  const map = {
    free: { Icon: Wallet, label: "Entrée gratuite", tone: "bg-surface-2 text-muted ring-1 ring-border" },
    locked: { Icon: Wallet, label: `Caution bloquée · ${amount}`, tone: "bg-gold-faint text-gold-bright ring-1 ring-gold/30" },
    to_refund: { Icon: RefreshCw, label: `Remboursement en cours · ${amount}`, tone: "batta-tone-warn" },
    refunded: { Icon: CheckCircle2, label: `Caution remboursée · ${amount}`, tone: "batta-tone-ok" },
    forfeited: { Icon: ShieldAlert, label: "Caution saisie", tone: "batta-tone-bad" },
  } as const;
  const { Icon, label, tone } = map[deposit.status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${tone}`}>
      <Icon className="size-2.5" strokeWidth={2.5} />
      {label}
    </span>
  );
}

/** Where a row leads: a receipt-pending caution opens checkout so the
 *  buyer can finish the upload; everything else opens the auction. */
function rowHref(item: ActivityItem): string {
  return item.pending?.kind === "receipt"
    ? `/payment/checkout?payment=${item.pending.paymentId}`
    : `/auctions/${item.auctionId}`;
}

/** Top-of-page "À traiter" strip — only the cautions where the buyer still
 *  has to upload a receipt. It's a shortcut; the same rows also live in the
 *  "En cours" tab, where they're highlighted. */
function ActionBanner({ items, locale }: { items: ActivityItem[]; locale: string }) {
  if (items.length === 0) return null;
  const ChevronEnd = locale === "ar" ? ChevronLeft : ChevronRight;
  return (
    <div className="mt-5 overflow-hidden rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30">
      <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
        <AlertTriangle className="size-3.5 text-amber-600" strokeWidth={2.6} />
        <span className="text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-amber-700">
          À traiter
        </span>
        <span className="batta-tabular ml-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-extrabold text-amber-700">
          {items.length}
        </span>
      </div>
      <ul className="divide-y divide-amber-500/15">
        {items.map((item) => (
          <li key={item.auctionId} id={`act-${item.auctionId}`}>
            <Link
              href={rowHref(item) as "/payment/checkout"}
              className="flex items-center gap-2.5 px-3.5 py-2.5 transition hover:bg-amber-500/10"
            >
              <span className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {item.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-sm text-foreground/20">
                    🏛️
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-foreground">{item.title}</div>
                <div className="text-[11px] font-semibold text-amber-700">Reçu à téléverser</div>
              </div>
              <ChevronEnd className="size-4 shrink-0 text-amber-600" strokeWidth={2.4} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ item, locale }: { item: ActivityItem; locale: string }) {
  const badge = statusBadge(item.status);
  const isScheduled = item.status === "scheduled";
  const isLive = item.status === "live" || item.status === "extending";
  // Countdown target: starts_at if it hasn't opened yet, ends_at while live.
  // Anything ended (sold, unsold, cancelled, awarded) gets no clock — just
  // the status badge already on the cover.
  const startsAtMs = item.startsAt ? new Date(item.startsAt).getTime() : null;
  const showStartCountdown =
    isScheduled && startsAtMs !== null && startsAtMs > Date.now();
  const showEndCountdown = isLive;
  const needsAction = item.pending?.kind === "receipt";

  return (
    <Link
      href={rowHref(item) as `/auctions/${string}`}
      className={`flex gap-3 overflow-hidden rounded-xl p-3 ring-1 transition-all ${
        needsAction
          ? "bg-amber-500/[0.06] ring-amber-500/40 hover:ring-amber-500/60"
          : "bg-surface ring-border hover:ring-gold-soft/40"
      }`}
    >
      <div className="relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-surface-2">
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverUrl} alt={item.title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-2xl text-foreground/15">
            🏛️
          </div>
        )}
        <span
          className={`absolute start-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${badge.tone}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold text-foreground">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
          <MapPin className="size-3 shrink-0" strokeWidth={2} />
          {item.governorate}
        </div>

        <div
          dir="ltr"
          className="batta-tabular gradient-gold-text mt-1.5 inline-flex items-baseline gap-1 text-[16px] font-extrabold leading-none"
        >
          {formatTND(item.price, locale)}
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">TND</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
          {item.pending && (
            <span className="batta-tone-warn inline-flex items-center gap-1 rounded-full px-2 py-0.5">
              <Clock className="size-2.5" strokeWidth={2.5} />
              {item.pending.kind === "review"
                ? "En attente de validation"
                : "Reçu à téléverser"}
            </span>
          )}
          {item.deposit && <DepositChip deposit={item.deposit} locale={locale} />}
          {item.myBid != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-foreground/85 ring-1 ring-border">
              <Gavel className="size-2.5" strokeWidth={2.5} />
              Mon offre : {formatTND(item.myBid, locale)}
            </span>
          )}
          {(showStartCountdown || showEndCountdown) && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.04] px-2 py-0.5 text-foreground/80 ring-1 ring-foreground/10">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  showEndCountdown ? "batta-pulse-dot bg-red-500" : "bg-gold"
                }`}
              />
              <LiveTimer
                endsAt={showEndCountdown ? item.endsAt : (item.startsAt as string)}
                className="batta-tabular text-[10.5px] font-bold !text-foreground/90"
              />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ActivityTabs({
  enCours,
  enAttente,
  gagnees,
  participees,
  favoris,
  locale = "fr",
  initialTab,
}: {
  enCours: ActivityItem[];
  enAttente: ActivityItem[];
  gagnees: ActivityItem[];
  participees: ActivityItem[];
  favoris: ActivityItem[];
  locale?: string;
  /** When set (deep link / redirect), open this tab even if it's empty.
   *  Accepts the legacy bucket keys and maps them onto the new tabs. */
  initialTab?: LegacyTabKey;
}) {
  // Merge the five server buckets into the three buyer tabs.
  const enCoursItems = [...enCours, ...enAttente].sort(
    (a, b) => enCoursRank(a) - enCoursRank(b),
  );
  const data: Record<TabKey, ActivityItem[]> = {
    enCours: enCoursItems,
    terminees: [...gagnees, ...participees],
    favoris,
  };

  // Things that genuinely need the buyer to act: a receipt still to upload.
  const actionItems = enAttente.filter((i) => i.pending?.kind === "receipt");

  const mappedInitial = initialTab ? LEGACY_TO_TAB[initialTab] : undefined;
  const [active, setActive] = useState<TabKey>(
    mappedInitial ??
      (data.enCours.length > 0
        ? "enCours"
        : data.terminees.length > 0
          ? "terminees"
          : "favoris"),
  );

  const items = data[active];
  const empty = EMPTY[active];
  const EmptyIcon = empty.icon;

  return (
    <div className="mt-1">
      <ActionBanner items={actionItems} locale={locale} />

      {/* Tab strip — each chip carries its own count so the user sees
          volume at a glance. */}
      <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = data[key].length;
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-all ${
                on
                  ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
                  : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" strokeWidth={2.5} />
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

      {items.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-12 text-center">
          <EmptyIcon className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mx-auto mt-3 max-w-xs text-[13px] leading-relaxed text-muted">
            {empty.text}
          </p>
          <Link
            href="/properties"
            className="batta-btn-luxe tap-target mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 text-[12.5px]"
          >
            <Search className="size-4" strokeWidth={2.5} />
            Parcourir les enchères
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5 pb-6">
          {items.map((item) => (
            <li key={item.auctionId} id={`act-${item.auctionId}`}>
              <Row item={item} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
