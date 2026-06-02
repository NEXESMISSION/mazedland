import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";
import { Countdown } from "@/components/auction/Countdown";
import { AuctionCalendarMenu } from "@/components/auction/AuctionCalendarMenu";
import { DirectSalePanel } from "@/components/auction/DirectSalePanel";
import { HeroCarousel } from "@/components/auction/HeroCarousel";
import { WatchlistButton } from "@/components/watchlist/WatchlistButton";
import { AuctionTerms } from "@/components/auction/AuctionTerms";
import { SellerAuctionBanner } from "@/components/auction/SellerAuctionBanner";
import { PropertyMap } from "@/components/property/PropertyMap";
import { PropertyDocumentOpenButton } from "@/components/property/PropertyDocumentOpenButton";
import {
  MapPin, Ruler, BedDouble, Bath, Building2, Calendar, ChevronRight,
  ClipboardCheck, FileText, Lock, Gavel, Download, Clock, Hourglass,
  ShieldCheck, Trophy, Wallet,
} from "lucide-react";

type AttrKind = {
  field_key: string;
  label: string;
  data_type: string;
  options: { value: string; label: string }[] | null;
  unit: string | null;
};

// Minimal skin — white surfaces, hairline borders, no heavy shadows.
const CARD = "rounded-2xl border border-black/[0.07] bg-white";

/**
 * Desktop (lg+) auction detail — minimal & clean, photos-first.
 * Big gallery on the left, a calm sticky action card on the right, then
 * generous full-width sections below. All transaction logic preserved.
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
  /** Balance the winner still owes (winner_amount − caution), or null when
   *  nothing is due / already paid. Drives the "Payer le solde" CTA. */
  winnerBalance: number | null;
}) {
  const {
    auction, totalBids, currentPrice, depositRequired, deposit,
    isLive, isDirect, hasBuyNow, isEnded, isOwner,
    kycVerified, hasActiveDeposit, depositUnderReview, userId,
    documents, attrKinds, attrs, myInspection,
    sellerFinalPayment, sellerActiveDeposits, winnerBalance,
  } = props;

  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const tnd = t("common.tnd");
  const property = auction.property;
  const photos = property.photos?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? [];
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();
  const showBidCta = !isDirect && !isEnded && !isOwner;
  const isWinner = !!auction.winner_user_id && userId === auction.winner_user_id;

  const startsAtMs = auction.starts_at ? new Date(auction.starts_at).getTime() : null;
  const showStart = !isLive && startsAtMs !== null && startsAtMs > Date.now();

  // Route the primary CTA straight to checkout when the only remaining step
  // is paying the caution — no hop through /bid (which would just redirect).
  // Every other state still goes to /bid for its login/KYC/composer screen.
  const skipToDeposit =
    userId !== null && !isOwner && kycVerified && depositRequired &&
    !hasActiveDeposit && !depositUnderReview &&
    (isLive || auction.status === "scheduled");
  const bidHref = (skipToDeposit
    ? `/payment/checkout?type=deposit&auction=${auction.id}`
    : `/auctions/${auction.id}/bid`) as never;

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

  const facts: { Icon: typeof Ruler; label: string; value: string }[] = [
    { Icon: Building2, label: t("property.type"), value: t(`property.types.${property.type}`) },
  ];
  const area = attrs.area_sqm ?? attrs.land_area_sqm;
  if (area != null && area !== "") facts.push({ Icon: Ruler, label: "Surface", value: `${area} m²` });
  if (attrs.rooms != null && attrs.rooms !== "") facts.push({ Icon: BedDouble, label: "Pièces", value: String(attrs.rooms) });
  if (attrs.bathrooms != null && attrs.bathrooms !== "") facts.push({ Icon: Bath, label: "SdB", value: String(attrs.bathrooms) });

  return (
    <div className="hidden lg:block mx-auto w-full max-w-[1180px] px-6 pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 pt-6 text-[12px] text-muted" aria-label="Breadcrumb">
        <Link href="/" className="transition-colors hover:text-gold">Accueil</Link>
        <ChevronRight className="size-3 opacity-50" />
        <Link href="/properties" className="transition-colors hover:text-gold">{t("nav.properties")}</Link>
        <ChevronRight className="size-3 opacity-50" />
        <span className="truncate text-foreground/70">{property.title}</span>
      </nav>

      {isOwner && (
        <div className="mt-4 [&>*]:!mx-0">
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
            tCommonTnd={tnd}
          />
        </div>
      )}

      {/* Header — status · title · location, above the gallery */}
      <div className="mt-5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gold-faint)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--gold)]">
              <Gavel className="size-3" strokeWidth={2.5} />
              {t(`auction.types.${auction.type}`)}
            </span>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
                <span className="batta-pulse-dot size-1.5 rounded-full bg-white text-white/40" />
                {t("auction.live")}
              </span>
            )}
            {isEnded && (
              <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted ring-1 ring-black/[0.06]">
                {auction.status === "ended_unsold" ? "Invendu" : auction.status === "cancelled" ? "Annulée" : "Adjugé"}
              </span>
            )}
          </div>
          <h1 className={`mt-3 text-[30px] font-extrabold leading-[1.1] tracking-tight text-foreground ${isRTL ? "font-arabic" : ""}`}>
            {property.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium text-muted">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4 text-gold" strokeWidth={2} />
              {property.governorate}
            </span>
            <span aria-hidden className="opacity-30">·</span>
            <span className="batta-tabular font-mono text-[11px] uppercase tracking-[0.12em]">Lot {lotNo}</span>
            {totalBids > 0 && !isDirect && (
              <>
                <span aria-hidden className="opacity-30">·</span>
                <span className="batta-tabular">{totalBids} {t("auction.totalBids")}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hero row — big gallery (left) + sticky action card (right) */}
      <div className="mt-5 grid grid-cols-12 items-start gap-8">
        <div className="col-span-7 min-w-0">
          <div className="overflow-hidden rounded-2xl border border-black/[0.07]">
            <HeroCarousel photos={photos} alt={property.title}>
              <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex items-start justify-between gap-2 px-4">
                {isLive && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
                    <span className="batta-pulse-dot size-1.5 rounded-full bg-white text-white/40" />
                    {t("auction.live")}
                  </span>
                )}
                <div className="pointer-events-auto ms-auto flex items-center gap-2">
                  {totalBids > 0 && (
                    <span className="batta-tabular inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 text-[10px] font-bold text-white backdrop-blur-md">
                      {totalBids} · {t("auction.totalBids")}
                    </span>
                  )}
                  {!isOwner && (
                    <WatchlistButton
                      auctionId={auction.id}
                      initialSaved={false}
                      loggedIn={userId !== null}
                    />
                  )}
                </div>
              </div>
            </HeroCarousel>
          </div>
        </div>

        <aside className="col-span-5">
          <div className="sticky flex flex-col gap-4" style={{ top: "calc(var(--desktop-nav-h) + 1rem)" }}>
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
              <div className={`${CARD} p-6`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="batta-eyebrow inline-flex items-center gap-2">
                    {isLive && <span className="size-1.5 rounded-full bg-gold pulse-gold" />}
                    {isEnded ? "Prix final" : isLive ? t("auction.currentBid") : "Mise à prix"}
                  </span>
                  <span className="batta-tabular text-[10px] text-muted">
                    dès {formatTND(auction.opening_price, locale)} {tnd}
                  </span>
                </div>
                <div className={`batta-tabular gradient-gold-text mt-1.5 text-[42px] font-extrabold leading-none tracking-tight ${isRTL ? "font-arabic" : ""}`}>
                  {formatTND(isEnded && auction.winner_amount ? Number(auction.winner_amount) : currentPrice, locale)}
                  <span className="ms-2 text-[13px] font-bold uppercase tracking-[0.16em] text-gold/70">{tnd}</span>
                </div>

                {isEnded ? (
                  <div className={`mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold ${
                    auction.status === "ended_unsold" ? "bg-surface-2 text-muted ring-1 ring-black/[0.06]"
                      : auction.status === "cancelled" ? "batta-tone-bad" : "batta-tone-ok"
                  }`}>
                    <Gavel className="size-4 shrink-0" strokeWidth={2.2} />
                    {auction.status === "ended_unsold" ? "Invendu — réserve non atteinte"
                      : auction.status === "cancelled" ? "Enchère annulée" : "Adjugé"}
                  </div>
                ) : (
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between rounded-xl bg-[var(--gold-faint)] px-3.5 py-3">
                      <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                        <Wallet className="size-4 text-gold" strokeWidth={2} /> Caution requise
                      </span>
                      <span className="batta-tabular text-[14px] font-extrabold text-foreground">
                        {depositRequired ? `${formatTND(deposit, locale)} ${tnd}` : "Gratuite"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-black/[0.05]">
                      <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                        <Clock className="size-4" strokeWidth={2} /> {showStart ? t("auction.startsIn") : t("auction.endsIn")}
                      </span>
                      <span className="batta-tabular text-[14px] font-bold text-foreground">
                        <Countdown endsAt={showStart ? (auction.starts_at as string) : auction.ends_at} />
                      </span>
                    </div>
                  </div>
                )}

                {showBidCta && (
                  <div className="mt-5">
                    {depositUnderReview && !hasActiveDeposit ? (
                      <Link href="/account/payments" className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-3.5 text-[13.5px] font-bold text-amber-700 transition active:scale-[0.99]">
                        <Clock className="size-4" strokeWidth={2.5} /> Caution en cours de validation
                      </Link>
                    ) : (
                      <Link href={bidHref} className="batta-gradient-gold inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[var(--shadow-gold)] transition active:scale-[0.99]">
                        <Gavel className="size-4" strokeWidth={2.5} /> {isLive ? t("auction.placeBid") : "Réserver ma place"}
                      </Link>
                    )}
                    {hasBuyNow && !isOwner && (
                      <Link href={`/payment/checkout?type=buy_now&auction=${auction.id}` as never} className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-black/[0.08] px-4 py-2.5 text-[12.5px] font-bold text-foreground transition hover:border-gold/40">
                        {t("auction.buyNowFor")}{" "}
                        <span className="font-extrabold text-gold-bright">{formatTND(Number(auction.buy_now_price), locale)} {tnd}</span>
                      </Link>
                    )}
                  </div>
                )}

                {!showBidCta && isWinner && winnerBalance != null && (
                  <div className="mt-5 rounded-2xl bg-[var(--gold-faint)] p-4 ring-1 ring-[var(--gold-soft)]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-muted">Solde à régler — caution déduite</span>
                      <span className="batta-tabular text-[15px] font-extrabold text-foreground">
                        {formatTND(winnerBalance, locale)} {tnd}
                      </span>
                    </div>
                    <Link
                      href={`/payment/checkout?type=final_payment&auction=${auction.id}` as never}
                      className="batta-gradient-gold mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[13.5px] font-extrabold uppercase tracking-[0.1em] text-white shadow-[var(--shadow-gold)] transition active:scale-[0.99]"
                    >
                      <Trophy className="size-4" strokeWidth={2.4} /> Payer le solde
                    </Link>
                  </div>
                )}
                {!showBidCta && isWinner && winnerBalance == null && (
                  <Link href={{ pathname: "/account/activity", query: { tab: "gagnees" } }} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--gold-faint)] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--gold)] ring-1 ring-[var(--gold-soft)] transition hover:underline">
                    <Trophy className="size-4" strokeWidth={2.2} /> {t("auction.myWins")} →
                  </Link>
                )}

                {!isEnded && (
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-black/[0.06] pt-3.5">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
                      <ShieldCheck className="size-3.5 text-gold" strokeWidth={2} />
                      {depositRequired ? "Caution remboursable · séquestre" : "Sans caution"}
                    </span>
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
              </div>
            )}

            {auction.status === "sixth_offer_window" && auction.winner_amount && auction.sixth_offer_deadline && !isOwner && isWinner && (
              <Link href={`/auctions/${auction.id}/bid` as never} className="batta-frame-gold flex items-center gap-3 rounded-2xl p-4 transition active:scale-[0.99]">
                <span className="batta-monogram size-10 shrink-0"><Hourglass className="size-4" strokeWidth={2.2} /></span>
                <div className="min-w-0 flex-1">
                  <div className="batta-eyebrow">Surenchère légale ouverte</div>
                  <div className="mt-0.5 text-[14px] font-bold text-foreground">Déposez votre offre du sixième</div>
                  <div className="mt-0.5 text-[11px] text-muted">Avant {new Date(auction.sixth_offer_deadline).toLocaleString(locale)}</div>
                </div>
                <span className="batta-gold-text text-[18px]">→</span>
              </Link>
            )}
          </div>
        </aside>
      </div>

      {/* ── Content sections — calm, full width ── */}
      <div className="mt-10 grid grid-cols-12 items-start gap-8">
        {/* Main */}
        <div className="col-span-7 min-w-0 space-y-6">
          {!isDirect && (
            <AuctionTerms
              auction={auction}
              currentPrice={currentPrice}
              deposit={deposit}
              depositRequired={depositRequired}
              totalBids={totalBids}
              isEnded={isEnded}
              isLive={isLive}
            />
          )}

          {/* Caractéristiques */}
          <section className={`${CARD} p-6`}>
            <h2 className="batta-eyebrow flex items-center gap-2">
              <span aria-hidden className="batta-gold-rule-short" />
              Caractéristiques
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-px sm:grid-cols-3">
              {specs.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 border-b border-black/[0.05] py-2.5">
                  <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                    <Spec_Icon Icon={specIcon(s.key)} /> {s.label}
                  </span>
                  <span className="batta-tabular text-[13px] font-bold text-foreground text-end">{s.value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Description */}
          {property.description && (
            <section className={`${CARD} p-6`}>
              <h2 className="batta-eyebrow flex items-center gap-2">
                <span aria-hidden className="batta-gold-rule-short" />
                Description
              </h2>
              <p className={`mt-3 whitespace-pre-line text-[14.5px] leading-relaxed text-foreground/85 ${isRTL ? "font-arabic" : ""}`}>
                {property.description}
              </p>
            </section>
          )}
        </div>

        {/* Side — trust + map */}
        <aside className="col-span-5 space-y-5">
          {/* Documents */}
          <section className={`${CARD} p-6`}>
            <h2 className="batta-eyebrow flex items-center gap-2">
              <span aria-hidden className="batta-gold-rule-short" />
              Documents
            </h2>
            <p className="mt-2 text-[11px] text-muted">
              {isEnded ? "Accès réservé aux participants vérifiés." : t("auction.depositRequired_long")}
            </p>
            <ul className="mt-3 divide-y divide-black/[0.06]">
              {documents.length === 0 && (
                <li className="py-3 text-[12px] text-muted">Aucun document pour le moment.</li>
              )}
              {documents.map((d) => {
                const canDownload = isOwner || (kycVerified && hasActiveDeposit);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="inline-flex items-center gap-2 text-[13px] text-foreground/85">
                      <FileText className="size-4 text-gold" strokeWidth={1.9} /> {d.kind}
                    </span>
                    {canDownload ? (
                      <PropertyDocumentOpenButton docId={d.id} title={d.kind} className="inline-flex items-center gap-1 rounded-full bg-[var(--gold-faint)] px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--gold)] transition active:scale-95">
                        <Download className="size-3" strokeWidth={2.5} /> Ouvrir
                      </PropertyDocumentOpenButton>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted">
                        <Lock className="size-3" strokeWidth={2} /> KYC + caution
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Inspection */}
          {myInspection ? (
            <section className={`${CARD} flex items-center gap-3 p-5`}>
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--gold-faint)] text-gold"><ClipboardCheck className="size-4" strokeWidth={2} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold text-foreground">{t("property.inspectionReport")}</div>
                <div className="mt-0.5 text-[11px] text-muted">Statut : {myInspection.status}</div>
              </div>
              <a href={`/api/inspector/report/${myInspection.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full bg-[var(--gold-faint)] px-4 py-2 text-[12px] font-bold text-[var(--gold)]">Ouvrir</a>
            </section>
          ) : (
            <section className={`${CARD} flex items-center gap-3 p-5`}>
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--gold-faint)] text-gold"><ClipboardCheck className="size-4" strokeWidth={2} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold text-foreground">{t("property.requestInspection")}</div>
                <div className="mt-0.5 text-[11px] text-muted">Rapport indépendant d&apos;un expert agréé.</div>
              </div>
              <Link href={`/inspectors/book?property=${property.id}` as `/inspectors/book`} className="shrink-0 rounded-full bg-[var(--gold-faint)] px-4 py-2 text-[12px] font-bold text-[var(--gold)]">Réserver</Link>
            </section>
          )}

          {/* Map */}
          {property.lat != null && property.lng != null && (
            <div className="overflow-hidden rounded-2xl border border-black/[0.07] [&>section]:!m-0 [&>section]:!rounded-2xl [&>section]:!border-0 [&>section]:!ring-0 [&_iframe]:!aspect-[4/3]">
              <PropertyMap lat={Number(property.lat)} lng={Number(property.lng)} address={property.address ?? property.governorate} />
            </div>
          )}
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

function Spec_Icon({ Icon }: { Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }) {
  return <Icon className="size-4 text-gold/70" strokeWidth={1.9} />;
}
