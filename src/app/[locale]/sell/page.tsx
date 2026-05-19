import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SellForm, type SellFormPricing } from "@/components/sell/SellForm";
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
  Building2,
  CheckCircle2,
  Hourglass,
  XCircle,
} from "lucide-react";

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

  // KYC gate. Tunisian law requires verified identity to list.
  const { data: profile } = await supabase
    .from("profiles")
    .select("kyc_status")
    .eq("id", user!.id)
    .single();
  const kycVerified = profile?.kyc_status === "verified";

  const pricing = await fetchSellPricing(supabase);

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
      <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
        <header>
          <span className="batta-eyebrow">Consign · new lot</span>
          <h1
            className={`mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("sell.title")}
          </h1>
          <p className="mt-1.5 text-[12.5px] text-muted">{t("sell.subtitle")}</p>
        </header>
        <div className="mt-5">
          <SellForm pricing={pricing} />
        </div>
      </div>
    );
  }

  // ─── Pull every piece of dashboard data in parallel ───────────────────
  const [listingsRes, balanceRes, payoutsRes] = await Promise.all([
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

  // First-time experience: no listings → straight to the new-lot form.
  if (listings.length === 0) {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
        <header>
          <span className="batta-eyebrow">Consign · new lot</span>
          <h1
            className={`mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("sell.title")}
          </h1>
          <p className="mt-1.5 text-[12.5px] text-muted">{t("sell.subtitle")}</p>
        </header>
        <div className="mt-5">
          <SellForm pricing={pricing} />
        </div>
      </div>
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
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-10 lg:max-w-[var(--max-w-content)]">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="batta-eyebrow">Tableau du vendeur</span>
          <h1
            className={`mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("sell.myListings")}
          </h1>
        </div>
        <Link
          href="/sell?new=1"
          className="batta-btn-luxe tap-target shrink-0 px-4 py-2.5 text-[12px]"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          {t("sell.addNew")}
        </Link>
      </header>

      {/* ─── Stat cards row ─── */}
      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <StatCard
          icon={<Building2 className="size-4" />}
          label="Annonces"
          value={String(listings.length)}
        />
        <StatCard
          icon={<Gavel className="size-4" />}
          label="Enchères en cours"
          value={String(liveCount)}
          highlight={liveCount > 0}
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Adjugées"
          value={String(soldCount)}
        />
        <StatCard
          icon={<Wallet className="size-4" />}
          label="Solde disponible"
          value={formatTND(balance.available, locale)}
          highlight={balance.available > 0}
        />
      </div>

      {/* ─── Earnings panel ─── */}
      <section className="mt-6 rounded-2xl border border-[var(--gold)]/20 bg-gradient-to-br from-[var(--surface)] to-[#1a1408] p-5 lg:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="batta-eyebrow inline-flex items-center gap-2">
              <Wallet className="size-3.5 text-[var(--gold)]" />
              Revenus
            </span>
            <div className="batta-tabular gradient-gold-text mt-1.5 text-[36px] lg:text-[40px] font-extrabold leading-none">
              {formatTND(balance.available, locale)}
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--foreground-muted)]">
              Disponible au retrait — commission Batta de {Math.round(balance.commission_rate * 100)}% déjà déduite.
            </p>
          </div>
          <PayoutRequestTrigger
            available={balance.available}
            locale={locale}
          />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 lg:gap-4">
          <MiniMetric
            label="Brut cumulé"
            value={formatTND(balance.lifetime_gross, locale)}
          />
          <MiniMetric
            label="Commission Batta"
            value={formatTND(balance.lifetime_commission, locale)}
            tone="muted"
          />
          <MiniMetric
            label="Déjà payé"
            value={formatTND(balance.paid_out, locale)}
            tone="muted"
          />
        </div>

        {balance.pending_payout > 0 && (
          <p className="mt-3 text-[11px] text-[var(--foreground-muted)] inline-flex items-center gap-1.5">
            <Hourglass className="size-3 text-[var(--gold)]" />
            {formatTND(balance.pending_payout, locale)} en cours de traitement.
          </p>
        )}
      </section>

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
            return (
              <li
                key={p.id}
                className="rounded-xl bg-surface p-4 ring-1 ring-border transition-all hover:ring-gold-soft/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`truncate text-[15px] font-bold leading-tight text-foreground ${
                        isRTL ? "font-arabic" : ""
                      }`}
                    >
                      {p.title}
                    </h3>
                    <div className="mt-1 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                      {p.governorate} · {p.type}
                    </div>
                    {status === "rejected" && p.rejection_reason && (
                      <div className="batta-tone-bad mt-2 rounded-md px-2 py-1 text-[10.5px]">
                        {p.rejection_reason}
                      </div>
                    )}
                  </div>
                  <StatusPill status={status} t={t} />
                </div>

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

                {(canSchedule || status === "rejected" || auction) && (
                  <div aria-hidden className="batta-hairline mt-3" />
                )}

                {canSchedule && (
                  <Link
                    href={`/sell/${p.id}/schedule` as `/sell/${string}/schedule`}
                    className="batta-btn-luxe tap-target mt-3 w-full px-4 py-2.5 text-[12px]"
                  >
                    <Gavel className="size-3.5" strokeWidth={2.5} />
                    {t("sell.scheduleCta")}
                  </Link>
                )}
                {status === "rejected" && (
                  <Link
                    href={`/sell/${p.id}/edit` as `/sell/${string}/edit`}
                    className="batta-btn-ghost-gold tap-target mt-3 w-full px-4 py-2.5 text-[12px]"
                  >
                    {t("sell.editCta")}
                  </Link>
                )}
                {auction && (
                  <Link
                    href={`/auctions/${auction.id}` as `/auctions/${string}`}
                    className="tap-target mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border bg-surface-2 py-2.5 text-[12px] font-semibold text-foreground hover:border-gold/40"
                  >
                    {t("schedule.viewAuction")}
                    <ChevronEnd className="size-3.5" strokeWidth={2} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── Payouts history ─── */}
      {payouts.length > 0 && (
        <section className="mt-8">
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
                  className="rounded-xl bg-surface p-3.5 ring-1 ring-border flex items-center justify-between gap-3"
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

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3.5 ring-1 ${
        highlight
          ? "bg-[var(--gold-faint)] ring-[var(--gold)]/30"
          : "bg-surface ring-border"
      }`}
    >
      <div
        className={`text-[10px] font-extrabold uppercase tracking-[0.16em] inline-flex items-center gap-1.5 ${
          highlight ? "text-[var(--gold)]" : "text-[var(--foreground-muted)]"
        }`}
      >
        {icon}
        {label}
      </div>
      <div
        className={`batta-tabular mt-1.5 text-[20px] lg:text-[22px] font-extrabold leading-none ${
          highlight ? "gradient-gold-text" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}) {
  return (
    <div>
      <div className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[var(--foreground-subtle)]">
        {label}
      </div>
      <div
        className={`batta-tabular mt-0.5 text-[13px] lg:text-[15px] font-bold ${
          tone === "muted"
            ? "text-[var(--foreground-muted)]"
            : "text-foreground"
        }`}
      >
        {value}
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
      "listing_fee_tnd",
      "listing_fee_offer_tnd",
      "promo_home_featured_tnd",
      "promo_top_listed_tnd",
      "promo_banner_tnd",
    ]);
  const m = new Map<string, number>();
  for (const r of data ?? []) {
    const v = (r as { value: unknown }).value;
    const n = typeof v === "number" ? v : Number(v);
    m.set((r as { key: string }).key, Number.isFinite(n) ? n : 0);
  }
  return {
    listing_fee_tnd: m.get("listing_fee_tnd") ?? 20,
    listing_fee_offer_tnd: m.get("listing_fee_offer_tnd") ?? 15,
    promo_home_featured_tnd: m.get("promo_home_featured_tnd") ?? 15,
    promo_top_listed_tnd: m.get("promo_top_listed_tnd") ?? 10,
    promo_banner_tnd: m.get("promo_banner_tnd") ?? 30,
  };
}
