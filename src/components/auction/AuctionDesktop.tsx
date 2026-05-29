import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";
import { Countdown } from "@/components/auction/Countdown";
import { AuctionCalendarMenu } from "@/components/auction/AuctionCalendarMenu";
import { DirectSalePanel } from "@/components/auction/DirectSalePanel";
import { HeroCarousel } from "@/components/auction/HeroCarousel";
import { SellerAuctionBanner } from "@/components/auction/SellerAuctionBanner";
import { PropertyMap } from "@/components/property/PropertyMap";
import { PropertyDocumentOpenButton } from "@/components/property/PropertyDocumentOpenButton";
import {
  MapPin, Ruler, BedDouble, Bath, Building2, Calendar, ChevronRight,
  ClipboardCheck, FileText, Lock, Gavel, Download, Clock, Hourglass,
} from "lucide-react";

type AttrKind = {
  field_key: string;
  label: string;
  data_type: string;
  options: { value: string; label: string }[] | null;
  unit: string | null;
};

/**
 * Desktop (lg+) auction detail — a clean two-column marketplace layout
 * (gallery + details on the left, a sticky price/bid panel on the
 * right), kept in its own file so the route's mobile tree is never
 * touched. Rendered behind `hidden lg:block`, so phones never pay for it.
 *
 * All server-truth (KYC, deposits, documents, specs, seller fork) is
 * computed once in the route and handed down as props — this component
 * only lays it out.
 */
export async function AuctionDesktop(props: {
  auction: AuctionWithProperty;
  totalBids: number;
  currentPrice: number;
  depositRequired: boolean;
  deposit: number;
  isLive: boolean;
  isDirect: boolean;
  hasBuyNow: boolean;
  isEnded: boolean;
  isOwner: boolean;
  kycVerified: boolean;
  hasActiveDeposit: boolean;
  depositUnderReview: boolean;
  userId: string | null;
  documents: Array<{ id: string; kind: string }>;
  attrKinds: AttrKind[];
  attrs: Record<string, string | number | boolean>;
  myInspection: { id: string; status: string } | null;
  sellerFinalPayment: { id: string; status: string; amount: number } | null;
  sellerActiveDeposits: number;
}) {
  const {
    auction, totalBids, currentPrice, depositRequired, deposit,
    isLive, isDirect, hasBuyNow, isEnded, isOwner,
    kycVerified, hasActiveDeposit, depositUnderReview, userId,
    documents, attrKinds, attrs, myInspection,
    sellerFinalPayment, sellerActiveDeposits,
  } = props;

  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const property = auction.property;
  const photos = property.photos?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? [];
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();
  const showBidCta = !isDirect && !isEnded && !isOwner;
  const isWinner = !!auction.winner_user_id && userId === auction.winner_user_id;

  // Build the spec tiles (canonical attributes + per-type catalog).
  const specs: { key: string; label: string; value: string }[] = [
    { key: "_type", label: t("property.type"), value: t(`property.types.${property.type}`) },
  ];
  for (const k of attrKinds) {
    const raw = attrs[k.field_key];
    if (raw == null || raw === "" || raw === false) continue;
    let value: string;
    if (k.data_type === "boolean") value = "Oui";
    else if (k.data_type === "select")
      value = k.options?.find((o) => o.value === raw)?.label ?? String(raw);
    else value = k.unit ? `${raw} ${k.unit}` : String(raw);
    specs.push({ key: k.field_key, label: k.label, value });
  }

  return (
    <div className="hidden lg:block mx-auto max-w-[var(--max-w-wide)] px-8 pb-16">
      {/* ── Breadcrumb ── */}
      <nav className="flex items-center gap-1.5 pt-6 text-[12px] text-muted" aria-label="Breadcrumb">
        <Link href="/" className="transition-colors hover:text-gold">Accueil</Link>
        <ChevronRight className="size-3 opacity-50" />
        <Link href="/properties" className="transition-colors hover:text-gold">
          {t("nav.properties")}
        </Link>
        <ChevronRight className="size-3 opacity-50" />
        <span className="truncate text-foreground/70">{property.title}</span>
      </nav>

      {/* ── Title header ── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="batta-gold-fill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
          <Gavel className="size-3" strokeWidth={2.5} />
          {t(`auction.types.${auction.type}`)}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-[0_0_18px_rgba(239,68,68,0.45)]">
            <span className="batta-pulse-dot size-1.5 rounded-full bg-white text-white/40" />
            {t("auction.live")}
          </span>
        )}
        {isEnded && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted ring-1 ring-border">
            {auction.status === "ended_unsold"
              ? "Invendu"
              : auction.status === "cancelled"
                ? "Annulée"
                : "Adjugé"}
          </span>
        )}
      </div>
      <h1
        className={`mt-3 text-[34px] font-extrabold leading-[1.08] tracking-tight text-foreground ${
          isRTL ? "font-arabic" : ""
        }`}
      >
        {property.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-muted">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-4 text-gold" strokeWidth={2} />
          {property.governorate}
        </span>
        <span aria-hidden className="opacity-30">·</span>
        <span className="batta-tabular font-mono text-[11px] uppercase tracking-[0.12em]">
          Lot {lotNo}
        </span>
        {totalBids > 0 && (
          <>
            <span aria-hidden className="opacity-30">·</span>
            <span className="batta-tabular">{totalBids} {t("auction.totalBids")}</span>
          </>
        )}
      </div>

      {/* ── Seller banner (owner only) — full width above the columns ── */}
      {isOwner && (
        <div className="mt-5 [&>*]:!mx-0">
          <SellerAuctionBanner
            auctionId={auction.id}
            propertyId={property.id}
            status={auction.status}
            startsAt={auction.starts_at ?? null}
            endsAt={auction.ends_at}
            currentPrice={currentPrice}
            winnerAmount={auction.winner_amount != null ? Number(auction.winner_amount) : null}
            totalBids={totalBids}
            activeDeposits={sellerActiveDeposits}
            finalPayment={sellerFinalPayment}
            locale={locale}
            tCommonTnd={t("common.tnd")}
          />
        </div>
      )}

      {/* ── Two-column body ── */}
      <div className="mt-6 grid grid-cols-12 gap-8">
        {/* LEFT — gallery + all the read content */}
        <div className="col-span-8 min-w-0">
          <div className="overflow-hidden rounded-2xl bg-surface pb-3 ring-1 ring-border shadow-[0_24px_60px_-34px_rgba(15,23,42,0.4)]">
            <HeroCarousel photos={photos} alt={property.title}>
              <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex items-start justify-between gap-2 px-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isLive && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-[0_0_18px_rgba(239,68,68,0.55)]">
                      <span className="batta-pulse-dot size-1.5 rounded-full bg-white text-white/40" />
                      {t("auction.live")}
                    </span>
                  )}
                </div>
                {totalBids > 0 && (
                  <span className="batta-tabular pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-md">
                    {totalBids} · {t("auction.totalBids")}
                  </span>
                )}
              </div>
            </HeroCarousel>
          </div>

          {/* SPECIFICATIONS */}
          <section className="batta-frame mt-7 p-6">
            <h2 className="batta-eyebrow flex items-center gap-2">
              <span aria-hidden className="batta-gold-rule-short" />
              Caractéristiques
            </h2>
            <div className="mt-4 grid grid-cols-4 gap-2.5">
              {specs.map((s) => (
                <Spec key={s.key} Icon={specIcon(s.key)} label={s.label} value={s.value} />
              ))}
            </div>
          </section>

          {/* DESCRIPTION */}
          {property.description && (
            <section className="batta-frame mt-6 p-6">
              <h2 className="batta-eyebrow flex items-center gap-2">
                <span aria-hidden className="batta-gold-rule-short" />
                Description
              </h2>
              <p
                className={`mt-2.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground/85 ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {property.description}
              </p>
            </section>
          )}

          {/* MAP — cancel the component's own mobile margins inside the column */}
          {property.lat != null && property.lng != null && (
            <div className="mt-6 [&>section]:!mx-0 [&>section]:!mt-0">
              <PropertyMap
                lat={Number(property.lat)}
                lng={Number(property.lng)}
                address={property.address ?? property.governorate}
              />
            </div>
          )}

          {/* INSPECTION */}
          {myInspection ? (
            <section className="batta-surface-ivory mt-6 flex items-center gap-3 rounded-2xl p-5">
              <span className="batta-monogram batta-monogram-filled size-11 shrink-0">
                <ClipboardCheck className="size-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="batta-eyebrow">Inspection</div>
                <div className="mt-0.5 text-[15px] font-bold text-foreground">
                  {t("property.inspectionReport")}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">Statut : {myInspection.status}</div>
              </div>
              <a
                href={`/api/inspector/report/${myInspection.id}`}
                target="_blank" rel="noopener noreferrer"
                className="batta-btn-luxe shrink-0 px-4 py-2 text-[12px]"
              >
                Ouvrir
              </a>
            </section>
          ) : (
            <section className="batta-surface-ivory mt-6 flex items-center gap-3 rounded-2xl p-5">
              <span className="batta-monogram size-11 shrink-0">
                <ClipboardCheck className="size-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="batta-eyebrow">Avant d&apos;enchérir</div>
                <div className="mt-0.5 text-[15px] font-bold text-foreground">
                  {t("property.requestInspection")}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  Rapport indépendant d&apos;un expert agréé.
                </div>
              </div>
              <Link
                href={`/inspectors/book?property=${property.id}` as `/inspectors/book`}
                className="batta-btn-luxe shrink-0 px-4 py-2 text-[12px]"
              >
                Réserver
              </Link>
            </section>
          )}

          {/* DOCUMENTS */}
          <section className="batta-frame mt-6 p-6">
            <h2 className="batta-eyebrow flex items-center gap-2">
              <span aria-hidden className="batta-gold-rule-short" />
              Documents
            </h2>
            <h3 className="mt-1 flex items-center gap-2 text-[16px] font-bold text-foreground">
              <FileText className="size-4 text-gold" strokeWidth={2} />
              {t("property.documents")}
            </h3>
            <p className="mt-1.5 text-[11px] text-muted">
              {isEnded
                ? "Accès réservé aux participants vérifiés."
                : t("auction.depositRequired_long")}
            </p>
            <ul className="mt-3 divide-y divide-border">
              {documents.length === 0 && (
                <li className="py-3 text-[12px] text-muted">Aucun document pour le moment.</li>
              )}
              {documents.map((d) => {
                const canDownload = isOwner || (kycVerified && hasActiveDeposit);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-[13px] text-foreground/85">{d.kind}</span>
                    {canDownload ? (
                      <PropertyDocumentOpenButton
                        docId={d.id}
                        title={d.kind}
                        className="batta-gold-fill inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] shadow-[var(--shadow-gold)] transition active:scale-95"
                      >
                        <Download className="size-3" strokeWidth={2.5} />
                        Ouvrir
                      </PropertyDocumentOpenButton>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted">
                        <Lock className="size-3" strokeWidth={2} /> KYC + deposit
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* RIGHT — sticky action panel */}
        <aside className="col-span-4">
          <div className="sticky top-[calc(var(--desktop-nav-h)+1rem)] flex flex-col gap-4">
            {isDirect ? (
              <div className="[&>*]:!mx-0 [&>*]:!mt-0">
                <DirectSalePanel
                  auction={auction}
                  userId={userId}
                  kycVerified={kycVerified}
                  isOwner={isOwner}
                  locale={locale}
                />
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-2xl bg-surface p-6 ring-1 ring-border shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="batta-eyebrow inline-flex items-center gap-2">
                    {isLive && <span className="size-1.5 rounded-full bg-gold pulse-gold" />}
                    {isEnded ? "Résultat" : isLive ? t("auction.currentBid") : "Mise à prix"}
                  </span>
                  <div className="batta-tabular text-[10px] text-muted">
                    dès {formatTND(auction.opening_price, locale)} {t("common.tnd")}
                  </div>
                </div>
                <div
                  className={`batta-tabular gradient-gold-text mt-2 text-[40px] font-extrabold leading-none tracking-tight ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  {formatTND(
                    isEnded && auction.winner_amount
                      ? Number(auction.winner_amount)
                      : currentPrice,
                    locale,
                  )}
                  <span className="ms-2 text-[13px] font-bold uppercase tracking-[0.16em] text-gold/80">
                    {t("common.tnd")}
                  </span>
                </div>

                {isEnded ? (
                  <div
                    className={`mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold ${
                      auction.status === "ended_unsold"
                        ? "bg-surface-2 text-muted ring-1 ring-border"
                        : auction.status === "cancelled"
                          ? "batta-tone-bad"
                          : "batta-tone-ok"
                    }`}
                  >
                    <Gavel className="size-4 shrink-0" strokeWidth={2.2} />
                    {auction.status === "ended_unsold"
                      ? "Invendu — prix de réserve non atteint"
                      : auction.status === "cancelled"
                        ? "Enchère annulée"
                        : "Adjugé"}
                  </div>
                ) : (
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-border">
                      {(() => {
                        const startsAt = auction.starts_at;
                        const startsAtMs = startsAt ? new Date(startsAt).getTime() : null;
                        const showStart =
                          !isLive && startsAtMs !== null && startsAtMs > Date.now();
                        return (
                          <>
                            <div className="batta-eyebrow text-[9px]">
                              {showStart ? t("auction.startsIn") : t("auction.endsIn")}
                            </div>
                            <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                              <Countdown endsAt={showStart ? (startsAt as string) : auction.ends_at} />
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-border">
                      <div className="batta-eyebrow text-[9px]">{t("auction.depositRequired")}</div>
                      <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                        {depositRequired ? `${formatTND(deposit, locale)} ${t("common.tnd")}` : "Gratuit"}
                      </div>
                    </div>
                  </div>
                )}

                {/* CTA — inline on desktop (no floating bottom bar). */}
                {showBidCta && (
                  <div className="mt-5">
                    {depositUnderReview && !hasActiveDeposit ? (
                      <Link
                        href="/account/payments"
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-amber-300 bg-amber-50 text-[13.5px] font-bold text-amber-700 transition active:scale-[0.99]"
                      >
                        <Clock className="size-4" strokeWidth={2.5} />
                        Caution en cours de validation
                      </Link>
                    ) : (
                      <Link
                        href={`/auctions/${auction.id}/bid` as never}
                        className="batta-gradient-gold inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[var(--shadow-gold)] ring-1 ring-black/5 transition active:scale-[0.99]"
                      >
                        <Gavel className="size-4" strokeWidth={2.5} />
                        {isLive ? t("auction.placeBid") : "Réserver ma place"}
                      </Link>
                    )}
                    {hasBuyNow && !isOwner && (
                      <Link
                        href={`/payment/checkout?type=buy_now&auction=${auction.id}` as never}
                        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-gold/30 px-4 py-2.5 text-[12.5px] font-bold text-foreground transition hover:border-gold-soft/60 hover:bg-gold-faint"
                      >
                        {t("auction.buyNowFor")}{" "}
                        <span className="font-extrabold text-gold-bright">
                          {formatTND(Number(auction.buy_now_price), locale)} {t("common.tnd")}
                        </span>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Calendar reminder — outside the card so its dropdown isn't clipped. */}
            {!isDirect && !isEnded && (
              <div className="flex justify-end">
                <AuctionCalendarMenu
                  auctionId={auction.id}
                  endsAt={auction.ends_at}
                  startsAt={auction.starts_at ?? null}
                  status={auction.status}
                  title={property.title}
                  governorate={property.governorate}
                />
              </div>
            )}

            {/* "You won" */}
            {!isDirect && isWinner && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--gold-faint)] px-4 py-3 ring-1 ring-[var(--gold-soft)]">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--gold)]">
                    {t("auction.wonByYou")}
                  </div>
                  <div className="batta-tabular mt-0.5 text-base font-bold text-foreground">
                    {formatTND(Number(auction.winner_amount ?? currentPrice), locale)}
                  </div>
                </div>
                <Link
                  href={{ pathname: "/account/activity", query: { tab: "gagnees" } }}
                  className="shrink-0 text-[12px] font-semibold text-[var(--gold)] hover:underline"
                >
                  {t("auction.myWins")} →
                </Link>
              </div>
            )}

            {/* Sixth-offer window (provisional winner only) */}
            {auction.status === "sixth_offer_window"
              && auction.winner_amount
              && auction.sixth_offer_deadline
              && !isOwner
              && isWinner && (
              <Link
                href={`/auctions/${auction.id}/bid` as never}
                className="batta-frame-gold flex items-center gap-3 rounded-2xl p-4 transition active:scale-[0.99]"
              >
                <span className="batta-monogram size-10 shrink-0">
                  <Hourglass className="size-4" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="batta-eyebrow">Surenchère légale ouverte</div>
                  <div className="mt-0.5 text-[14px] font-bold text-foreground">
                    Déposez votre offre du sixième
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    Avant {new Date(auction.sixth_offer_deadline).toLocaleString(locale)}
                  </div>
                </div>
                <span className="batta-gold-text text-[18px]">→</span>
              </Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function specIcon(
  key: string,
): React.ComponentType<{ className?: string; strokeWidth?: number }> {
  switch (key) {
    case "area_sqm":
    case "land_area_sqm":
    case "frontage_m":
    case "ceiling_height_m":
      return Ruler;
    case "rooms":
      return BedDouble;
    case "bathrooms":
      return Bath;
    case "year_built":
      return Calendar;
    default:
      return Building2;
  }
}

function Spec({
  Icon, label, value,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-faint text-gold ring-1 ring-gold/30">
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
          {label}
        </div>
        <div className="batta-tabular mt-0.5 truncate text-[15px] font-bold text-foreground">
          {value}
        </div>
      </div>
    </div>
  );
}
