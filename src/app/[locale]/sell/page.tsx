import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SellForm, type SellFormPricing } from "@/components/sell/SellForm";
import { parseMonetizationSettings } from "@/lib/pricing";
import { CancelAuctionButton } from "@/components/sell/CancelAuctionButton";
import { PayoutRequestTrigger } from "@/components/sell/PayoutRequestModal";
import { formatTND } from "@/lib/utils";
import {
  Plus,
  Gavel,
  BadgeCheck,
  ChevronRight,
  ChevronLeft,
  Wallet,
  Eye,
  XCircle,
  AlertTriangle,
  Pencil,
  Receipt,
  ArrowRight,
  ShieldCheck,
  Clock,
  Images,
} from "lucide-react";
import { parseRejection } from "@/lib/rejection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ListingRow {
  id: string;
  title: string;
  type: string;
  governorate: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

interface AuctionLite {
  id: string;
  property_id: string;
  status: string;
  opening_price: number;
  current_price: number | null;
  ends_at: string;
  winner_amount: number | null;
}

interface PayoutRow {
  id: string;
  amount: number;
  status: string;
  iban: string | null;
  reviewer_notes: string | null;
  processed_at: string | null;
  created_at: string;
}

interface BalanceShape {
  lifetime_gross: number;
  lifetime_net: number;
  lifetime_commission: number;
  paid_out: number;
  pending_payout: number;
  available: number;
  commission_rate: number;
}

const PAYOUT_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  requested:  { label: "En attente",       tone: "batta-tone-warn" },
  processing: { label: "En traitement",    tone: "batta-tone-warn" },
  paid:       { label: "Payé",             tone: "batta-tone-ok" },
  rejected:   { label: "Refusé",           tone: "batta-tone-bad" },
};

export default async function SellLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale } = await params;
  const { new: showForm } = await searchParams;
  const t = await getTranslations();
  const currentLocale = await getLocale();
  const isRTL = currentLocale === "ar";
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  // KYC status + pricing settings are independent, so fetch them together
  // (one round-trip wave instead of two back-to-back).
  const [{ data: profile }, pricing] = await Promise.all([
    supabase.from("profiles").select("kyc_status").eq("id", user!.id).single(),
    fetchSellPricing(supabase),
  ]);
  // KYC gate. Tunisian law requires verified identity to list.
  const kycVerified = profile?.kyc_status === "verified";

  if (!kycVerified) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--batta-topbar-h)-var(--batta-bottombar-total)-var(--batta-safe-top)-var(--batta-safe-bottom))] items-center justify-center px-4 py-8">
        <div className="batta-frame flex w-full max-w-[480px] flex-col items-center p-8 text-center">
          <span className="batta-monogram mb-5 size-11">
            <BadgeCheck className="size-5" strokeWidth={1.8} />
          </span>
          <h1
            className={`text-[22px] font-bold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("sell.kycRequired")}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            {t("sell.kycRequiredBody")}
          </p>
          <Link
            href="/kyc"
            className="batta-btn-luxe tap-target mt-6 w-full px-5 py-3 text-[13.5px]"
          >
            {t("sell.verifyNow")}
          </Link>
        </div>
      </div>
    );
  }

  // Force the form view via `?new=1` (unchanged from old behavior — the
  // partner dashboard and "+ New listing" button deep-link here).
  if (showForm) {
    return (
      <NewListingView
        pricing={pricing}
        title={t("sell.title")}
        subtitle={t("sell.subtitle")}
        isRTL={isRTL}
      />
    );
  }

  // ─── Pull every piece of dashboard data in parallel ───────────────────
  const [listingsRes, balanceRes, payoutsRes, failedPaymentsRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, title, type, governorate, status, rejection_reason, created_at")
      .eq("owner_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("seller_balance", { p_seller_id: user!.id }),
    supabase
      .from("seller_payouts")
      .select("id, amount, status, iban, reviewer_notes, processed_at, created_at")
      .eq("seller_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(10),
    // Receipts the admin refused (or that the system auto-failed because
    // the underlying property was rejected). Surfaced in the "Action
    // requise" block so the seller has one place to see what's blocking
    // their listing from going live.
    supabase
      .from("payments")
      .select(
        "id, kind, amount, admin_notes, reviewed_at, property_id, auction_id, property:properties(id, title)",
      )
      .eq("user_id", user!.id)
      .eq("status", "failed")
      .order("reviewed_at", { ascending: false })
      .limit(20),
  ]);

  const listings = (listingsRes.data ?? []) as ListingRow[];
  const balance: BalanceShape = (balanceRes.data ?? {
    lifetime_gross: 0,
    lifetime_net: 0,
    lifetime_commission: 0,
    paid_out: 0,
    pending_payout: 0,
    available: 0,
    commission_rate: 0.05,
  }) as BalanceShape;
  const payouts = (payoutsRes.data ?? []) as PayoutRow[];
  type FailedPaymentRow = {
    id: string;
    kind: string;
    amount: number;
    admin_notes: string | null;
    reviewed_at: string | null;
    property_id: string | null;
    auction_id: string | null;
    property: { id: string; title: string } | { id: string; title: string }[] | null;
  };
  const failedPayments = (failedPaymentsRes.data ?? []) as FailedPaymentRow[];

  // First-time experience: no listings → straight to the new-lot form.
  if (listings.length === 0) {
    return (
      <NewListingView
        pricing={pricing}
        title={t("sell.title")}
        subtitle={t("sell.subtitle")}
        isRTL={isRTL}
      />
    );
  }

  // ─── Enrich listings with auction + bid + watch counts (one round-trip
  //     per metric, parallelized; cheap at single-seller volumes). ───────
  const propIds = listings.map((p) => p.id);
  const [openAuctionsRes, allAuctionsRes] = await Promise.all([
    supabase
      .from("auctions")
      .select("id, property_id, status, opening_price, current_price, ends_at, winner_amount")
      .in("property_id", propIds)
      .not("status", "in", "(cancelled,ended_unsold)"),
    supabase
      .from("auctions")
      .select("id, property_id, status, opening_price, current_price, ends_at, winner_amount")
      .in("property_id", propIds),
  ]);

  const openAuctions = (openAuctionsRes.data ?? []) as AuctionLite[];
  const allAuctions = (allAuctionsRes.data ?? []) as AuctionLite[];

  // Bid + watch counts per auction id. We could do this in a single
  // group-by but PostgREST doesn't expose that cleanly; the in() filter
  // is fast enough for a seller's listings.
  const auctionIds = allAuctions.map((a) => a.id);
  const [bidCountsRes, watchCountsRes] = auctionIds.length
    ? await Promise.all([
        supabase
          .from("bids")
          .select("auction_id")
          .in("auction_id", auctionIds),
        supabase
          .from("watchlist")
          .select("auction_id")
          .in("auction_id", auctionIds),
      ])
    : [{ data: [] as { auction_id: string }[] }, { data: [] as { auction_id: string }[] }];

  const bidCount = new Map<string, number>();
  for (const b of bidCountsRes.data ?? []) {
    bidCount.set(b.auction_id, (bidCount.get(b.auction_id) ?? 0) + 1);
  }
  const watchCount = new Map<string, number>();
  for (const w of watchCountsRes.data ?? []) {
    watchCount.set(w.auction_id, (watchCount.get(w.auction_id) ?? 0) + 1);
  }

  const auctionByProperty = new Map<string, AuctionLite>();
  for (const a of openAuctions) auctionByProperty.set(a.property_id, a);

  // High-level dashboard counts.
  const liveCount = allAuctions.filter(
    (a) => a.status === "live" || a.status === "extending",
  ).length;
  const soldCount = allAuctions.filter(
    (a) => a.status === "ended_sold" || a.status === "awarded",
  ).length;

  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-12 lg:max-w-3xl lg:px-6 lg:pt-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <span className="batta-eyebrow">Espace vendeur</span>
          <h1
            className={`mt-1.5 text-[24px] lg:text-[30px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            Tableau du vendeur
          </h1>
        </div>
        <Link
          href="/sell?new=1"
          className="batta-gradient-gold tap-target inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[12.5px] font-bold text-white shadow-[var(--shadow-gold)] transition active:scale-[0.97]"
        >
          <Plus className="size-4" strokeWidth={2.6} />
          {t("sell.addNew")}
        </Link>
      </header>

      {/* ─── Earnings — the lead. Big available balance, the withdraw action
          right beside it, pending + commission as a quiet subline. ─── */}
      <section className="mt-6 rounded-2xl border border-black/[0.07] bg-white p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="batta-eyebrow flex items-center gap-1.5">
              <Wallet className="size-3" strokeWidth={2.4} />
              Solde disponible
            </div>
            <div dir="ltr" className="batta-tabular mt-2 flex items-baseline gap-1.5">
              <span className="gradient-gold-text text-[40px] font-extrabold leading-none">
                {formatTND(balance.available, locale)}
              </span>
              <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-muted">
                {t("common.tnd")}
              </span>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">
              En attente : <span className="batta-tabular font-semibold text-foreground/70">{formatTND(balance.pending_payout, locale)} {t("common.tnd")}</span>
              {" · "}Commission Batta {Math.round(balance.commission_rate * 100)}% déjà déduite.
            </p>
          </div>
          {balance.available > 0 && (
            <PayoutRequestTrigger available={balance.available} locale={locale} />
          )}
        </div>
      </section>

      {/* ─── Stats — three tiles. ─── */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Annonces" value={listings.length} />
        <Stat label="En cours" value={liveCount} highlight={liveCount > 0} />
        <Stat label="Adjugées" value={soldCount} />
      </div>

      {/* ─── Action requise — only rendered when something is blocking
              a listing. Surfaces both kinds of blockers in one place so
              the seller doesn't have to dig through notifications:
                · property rejected → "Corriger l'annonce" → /sell/<id>/edit
                · receipt rejected  → "Renvoyer le reçu"   → checkout
              Each row shows the category badge + the cleaned motif. ─── */}
      {(() => {
        const rejectedListings = listings.filter(
          (l) => l.status === "rejected" && l.rejection_reason,
        );
        // De-dupe: if a property was rejected, we auto-failed its receipt
        // with a "annonce refusée" note — don't show both rows for the
        // same listing. Keep the property card (more actionable: fix the
        // listing first; a new receipt is generated on resubmit).
        const rejectedListingIds = new Set(rejectedListings.map((l) => l.id));
        const receiptIssues = failedPayments.filter(
          (p) => p.kind === "listing_fee" && !(p.property_id && rejectedListingIds.has(p.property_id)),
        );
        const totalActions = rejectedListings.length + receiptIssues.length;
        if (totalActions === 0) return null;
        return (
          <section className="mt-6">
            <h2 className="batta-eyebrow flex items-center gap-2 text-[var(--danger)]">
              <AlertTriangle className="size-3.5" strokeWidth={2.5} />
              Action requise · {totalActions}
            </h2>
            <ul className="mt-3 space-y-2.5">
              {rejectedListings.map((p) => {
                const r = parseRejection(p.rejection_reason);
                const editHref = r.tagged && r.categories.length > 0
                  ? `/sell/${p.id}/edit?focus=${r.categories.join(",")}`
                  : `/sell/${p.id}/edit`;
                return (
                  <li
                    key={p.id}
                    className="rounded-2xl bg-[var(--danger)]/5 p-4 ring-1 ring-[var(--danger)]/20"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--danger)]/15 text-[var(--danger)] ring-1 ring-[var(--danger)]/25">
                        <Pencil className="size-4" strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--danger)]">
                            À corriger · {r.label}
                          </span>
                          <span className="text-[10.5px] text-muted">
                            {p.governorate} · {p.type}
                          </span>
                        </div>
                        <h3
                          className={`mt-1 line-clamp-1 text-[14px] font-bold ${isRTL ? "font-arabic" : ""}`}
                        >
                          {p.title}
                        </h3>
                        {r.message && (
                          <p className="mt-1.5 text-[12px] leading-snug text-foreground/85">
                            {r.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      href={editHref as `/sell/${string}/edit`}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--danger)] px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-red-700"
                    >
                      Corriger {r.tagged
                        ? r.categories.length > 1
                          ? `· ${r.categories.length} sections`
                          : `· ${r.label.toLowerCase()}`
                        : "l'annonce"}
                      <ArrowRight className="size-3.5" strokeWidth={2.5} />
                    </Link>
                  </li>
                );
              })}
              {receiptIssues.map((p) => {
                const r = parseRejection(p.admin_notes);
                const prop = Array.isArray(p.property) ? p.property[0] : p.property;
                return (
                  <li
                    key={p.id}
                    className="rounded-2xl bg-[var(--danger)]/5 p-4 ring-1 ring-[var(--danger)]/20"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--danger)]/15 text-[var(--danger)] ring-1 ring-[var(--danger)]/25">
                        <Receipt className="size-4" strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--danger)]">
                          Reçu refusé · {formatTND(Number(p.amount), locale)} TND
                        </span>
                        {prop && (
                          <h3 className="mt-1 line-clamp-1 text-[14px] font-bold">
                            {prop.title}
                          </h3>
                        )}
                        {r.message && (
                          <p className="mt-1.5 text-[12px] leading-snug text-foreground/85">
                            {r.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/payment/checkout?payment=${p.id}` as `/payment/checkout?payment=${string}`}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--danger)] px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-red-700"
                    >
                      Renvoyer le reçu
                      <ArrowRight className="size-3.5" strokeWidth={2.5} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      {/* ─── Listings ─── */}
      <section className="mt-6">
        <h2 className="batta-eyebrow flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Mes annonces
        </h2>
        <ul className="mt-3 space-y-2.5">
          {listings.map((p) => {
            const status = p.status;
            const auction = auctionByProperty.get(p.id);
            const canSchedule = status === "ready" && !auction;
            const bids = auction ? (bidCount.get(auction.id) ?? 0) : 0;
            const watches = auction ? (watchCount.get(auction.id) ?? 0) : 0;
            const price =
              auction?.current_price ?? auction?.opening_price ?? null;
            // Tap the row to see the listing: its live auction if it has
            // one, otherwise the editable detail of what was submitted.
            const detailHref = auction
              ? (`/auctions/${auction.id}` as `/auctions/${string}`)
              : (`/sell/${p.id}/edit` as `/sell/${string}/edit`);
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-black/[0.07] bg-white p-4 transition hover:border-gold/30"
              >
                <Link
                  href={detailHref}
                  className="group flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`truncate text-[15px] font-bold leading-tight text-foreground transition-colors group-hover:text-[var(--gold)] ${
                        isRTL ? "font-arabic" : ""
                      }`}
                    >
                      {p.title}
                    </h3>
                    <div className="mt-1 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                      {p.governorate} · {p.type}
                    </div>
                    {status === "rejected" && p.rejection_reason && (() => {
                      const r = parseRejection(p.rejection_reason);
                      return (
                        <div className="batta-tone-bad mt-2 rounded-md px-2 py-1 text-[10.5px]">
                          {r.tagged && (
                            <span className="me-1 font-extrabold uppercase tracking-[0.12em]">
                              {r.label} ·
                            </span>
                          )}
                          {r.message}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusPill status={status} t={t} />
                    <ChevronEnd className="size-4 text-muted transition-colors group-hover:text-[var(--gold)]" />
                  </div>
                </Link>

                {/* Auction metrics row — only when there's an auction tied
                    to the listing. */}
                {auction && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[var(--foreground-muted)] batta-tabular">
                    {price != null && (
                      <span>
                        <span className="text-[var(--gold)] font-bold">
                          {formatTND(price, locale)}
                        </span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Gavel className="size-3" />
                      {bids} {bids === 1 ? "offre" : "offres"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="size-3" />
                      {watches} {watches === 1 ? "suivi" : "suivis"}
                    </span>
                  </div>
                )}

                {/* One clear action per card. The whole card row already
                    links to the auction (or the editable detail), so we
                    don't repeat a "view auction" button here — we only
                    surface the action the listing actually needs next:
                      · ready, no auction → schedule it (primary)
                      · rejected          → fix it (ghost)
                      · live, no bids yet → cancel (subtle)
                    Cancel is gated on bids === 0; the API re-checks the
                    count server-side, so this UI gate is cosmetic. */}
                {(() => {
                  const canCancel =
                    !!auction &&
                    ["scheduled", "live", "extending"].includes(auction.status) &&
                    bids === 0;
                  if (!canSchedule && status !== "rejected" && !canCancel) return null;
                  return (
                    <>
                      <div aria-hidden className="batta-hairline mt-3" />
                      {canSchedule && (
                        <Link
                          href={`/sell/${p.id}/schedule` as `/sell/${string}/schedule`}
                          className="batta-btn-luxe tap-target mt-3 w-full px-4 py-2.5 text-[12px]"
                        >
                          <Gavel className="size-3.5" strokeWidth={2.5} />
                          {t("sell.scheduleCta")}
                        </Link>
                      )}
                      {status === "rejected" && (() => {
                        const r = parseRejection(p.rejection_reason);
                        const href = r.tagged && r.categories.length > 0
                          ? `/sell/${p.id}/edit?focus=${r.categories.join(",")}`
                          : `/sell/${p.id}/edit`;
                        return (
                          <Link
                            href={href as `/sell/${string}/edit`}
                            className="batta-btn-ghost-gold tap-target mt-3 w-full px-4 py-2.5 text-[12px]"
                          >
                            {t("sell.editCta")}
                          </Link>
                        );
                      })()}
                      {canCancel && (
                        <div className="mt-2">
                          <CancelAuctionButton
                            auctionId={auction!.id}
                            propertyTitle={p.title}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── Payouts history ─── */}
      {payouts.length > 0 && (
        <section id="payouts" className="mt-8 scroll-mt-20">
          <h2 className="batta-eyebrow flex items-center gap-2">
            <span aria-hidden className="batta-gold-rule-short" />
            Historique des retraits
          </h2>
          <ul className="mt-3 space-y-2">
            {payouts.map((p) => {
              const tone = PAYOUT_STATUS_LABEL[p.status] ?? {
                label: p.status,
                tone: "bg-surface-2 text-muted ring-1 ring-border",
              };
              return (
                <li
                  key={p.id}
                  className="rounded-2xl border border-black/[0.07] bg-white p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="batta-tabular text-[14px] font-bold text-foreground">
                      {formatTND(Number(p.amount), locale)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                      {new Date(p.created_at).toLocaleString("fr-FR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {p.iban && (
                        <>
                          {" · "}
                          <span className="font-mono">
                            {p.iban.slice(0, 4)}…{p.iban.slice(-4)}
                          </span>
                        </>
                      )}
                    </div>
                    {p.status === "rejected" && p.reviewer_notes && (
                      <div className="batta-tone-bad mt-1.5 rounded-md px-2 py-1 text-[10.5px] inline-flex items-start gap-1.5">
                        <XCircle className="size-3 mt-0.5 shrink-0" />
                        {p.reviewer_notes}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone.tone}`}
                  >
                    {tone.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div aria-hidden className="h-6" />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white px-2 py-4 text-center">
      <div
        className={`batta-tabular text-[26px] font-extrabold leading-none ${
          highlight ? "gradient-gold-text" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
        {label}
      </div>
    </div>
  );
}

// Shared header for the new-listing form (both the empty-state and the
// explicit `?new=1` entry point). Replaces the old English eyebrow.
function NewListingHeader({
  title,
  subtitle,
  isRTL,
}: {
  title: string;
  subtitle: string;
  isRTL: boolean;
}) {
  return (
    <header>
      <span className="batta-eyebrow flex items-center gap-2">
        <span aria-hidden className="batta-gold-rule-short" />
        Nouvelle annonce
      </span>
      <h1
        className={`mt-2 text-[26px] font-extrabold leading-tight tracking-tight ${
          isRTL ? "font-arabic" : ""
        }`}
      >
        {title}
      </h1>
      <p className="mt-1.5 text-[12.5px] text-muted">{subtitle}</p>
    </header>
  );
}

/**
 * New-listing surface.
 *   - Mobile (< lg): the original single column — header on top, form below.
 *   - Desktop (lg+): a two-column workspace — a sticky value/guide rail on
 *     the left (why-sell + what-to-prepare + trust), the multi-step form in
 *     a clean card on the right. The form (with its own stepper) is rendered
 *     once and reflowed responsively, so mobile is untouched.
 */
function NewListingView({
  pricing,
  title,
  subtitle,
  isRTL,
}: {
  pricing: SellFormPricing;
  title: string;
  subtitle: string;
  isRTL: boolean;
}) {
  const VALUE = [
    { Icon: ShieldCheck, title: "Acheteurs vérifiés", body: "Identité et caution validées avant chaque enchère." },
    { Icon: Wallet, title: "Paiement sécurisé", body: "Les fonds passent par un séquestre régulé." },
    { Icon: Clock, title: "En ligne sous 24 h", body: "Votre annonce est vérifiée puis publiée rapidement." },
  ];
  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-10 lg:max-w-[var(--max-w-wide)] lg:px-8 lg:py-10">
      <div className="lg:grid lg:grid-cols-12 lg:gap-10 lg:items-start">
        {/* Guide — mobile header (< lg) / sticky value rail (lg+) */}
        <div className="lg:col-span-4 lg:sticky lg:top-[calc(var(--desktop-nav-h)+1.5rem)]">
          <div className="lg:hidden">
            <NewListingHeader title={title} subtitle={subtitle} isRTL={isRTL} />
          </div>

          <div className="hidden lg:block">
            <span className="batta-eyebrow flex items-center gap-2">
              <span aria-hidden className="batta-gold-rule-short" />
              Nouvelle annonce
            </span>
            <h1
              className={`mt-3 text-[30px] font-extrabold leading-[1.1] tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              {title}
            </h1>
            <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{subtitle}</p>

            <ul className="mt-7 space-y-3">
              {VALUE.map((v) => (
                <li
                  key={v.title}
                  className="flex items-start gap-3.5 rounded-2xl border border-black/[0.07] bg-white p-4"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/15">
                    <v.Icon className="size-5" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold leading-tight text-foreground">
                      {v.title}
                    </div>
                    <div className="mt-0.5 text-[12px] leading-snug text-muted">{v.body}</div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex items-center gap-1.5 rounded-2xl bg-gold-faint px-4 py-3 text-[12px] font-semibold text-foreground ring-1 ring-gold/15">
              <Images className="size-4 shrink-0 text-gold" strokeWidth={2} />
              À préparer : photos, détails du bien et prix de départ.
            </div>
          </div>
        </div>

        {/* Form — single column on mobile, framed card on desktop */}
        <div className="mt-5 lg:mt-0 lg:col-span-8">
          <div className="lg:rounded-2xl lg:border lg:border-black/[0.07] lg:bg-white lg:p-8 lg:[&>form]:!mt-0">
            <SellForm pricing={pricing} />
          </div>
        </div>
      </div>
    </div>
  );
}


function StatusPill({
  status,
  t,
}: {
  status: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const tone =
    status === "ready"          ? "batta-tone-ok" :
    status === "pending_review" ? "batta-tone-warn" :
    status === "rejected"       ? "batta-tone-bad" :
                                  "bg-surface-2 text-muted ring-1 ring-border";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone}`}
    >
      {t(`sell.status.${status}` as "sell.status.draft")}
    </span>
  );
}

/**
 * Pull the four tunable price keys from `app_settings` so the sell form
 * can show "+15 TND" labels on each promotion option. Falls back to safe
 * defaults if a key is missing so the page doesn't crash on a fresh DB.
 */
async function fetchSellPricing(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
): Promise<SellFormPricing> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "fee_listing_auction",
      "fee_listing_direct",
      "promo_home",
      "promo_top",
      "promo_banner",
    ]);
  const m = new Map<string, unknown>();
  for (const r of data ?? []) m.set((r as { key: string }).key, (r as { value: unknown }).value);
  const mon = parseMonetizationSettings(m);
  return {
    feeAuction: mon.feeListingAuction,
    feeDirect: mon.feeListingDirect,
    promoHome: mon.promoHome,
    promoTop: mon.promoTop,
    promoBanner: mon.promoBanner,
  };
}
