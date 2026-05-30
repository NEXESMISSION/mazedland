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
  ShieldCheck, Trophy,
} from "lucide-react";

type AttrKind = {
  field_key: string;
  label: string;
  data_type: string;
  options: { value: string; label: string }[] | null;
  unit: string | null;
};

/**
 * Desktop (lg+) auction detail — laid out like a standard e-commerce product
 * page so it reads the way shoppers expect:
 *
 *   ┌─ gallery (left) ─┐ ┌─ buy box (right, sticky) ─┐
 *   │  main + thumbs   │ │ title · price · countdown │
 *   │                  │ │ deposit · BID CTA · buy-now│
 *   └──────────────────┘ └───────────────────────────┘
 *   ── full-width below: specs · description · map · inspection/docs ──
 *
 * The "buy box" holds everything needed to transact and sticks while the
 * gallery scrolls; the read-everything detail sections span the full width
 * underneath. Kept in its own file behind `hidden lg:block`; all
 * server-truth is computed in the route and passed down as props.
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
  const tnd = t("common.tnd");
  const property = auction.property;
  const photos = property.photos?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? [];
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();
  const showBidCta = !isDirect && !isEnded && !isOwner;
  const isWinner = !!auction.winner_user_id && userId === auction.winner_user_id;

  const startsAtMs = auction.starts_at ? new Date(auction.starts_at).getTime() : null;
  const showStart = !isLive && startsAtMs !== null && startsAtMs > Date.now();

  // Full spec list (canonical attributes + per-type catalog).
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

  // A few headline facts for the buy-box quick line (area / rooms / baths).
  const facts: { Icon: typeof Ruler; text: string }[] = [];
  const area = attrs.area_sqm ?? attrs.land_area_sqm;
  if (area != null && area !== "") facts.push({ Icon: Ruler, text: `${area} m²` });
  if (attrs.rooms != null && attrs.rooms !== "") facts.push({ Icon: BedDouble, text: `${attrs.rooms}` });
  if (attrs.bathrooms != null && attrs.bathrooms !== "") facts.push({ Icon: Bath, text: `${attrs.bathrooms}` });

  return (
    <div className="hidden lg:block mx-auto w-full max-w-[1180px] px-6 pb-24">
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

      {/* ── Seller banner (owner only) — full width above the product row ── */}
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

      {/* ── PRODUCT ROW: gallery (left) + buy box (right) ── */}
      <div className="mt-5 grid grid-cols-12 items-start gap-8">
        {/* LEFT — gallery */}
        <div className="col-span-7 min-w-0">
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
        </div>

        {/* RIGHT — buy box */}
        <aside className="col-span-5">
          <div className="sticky flex flex-col gap-4" style={{ top: "calc(var(--desktop-nav-h) + 1rem)" }}>
            {/* Identity */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
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
                    {auction.status === "ended_unsold" ? "Invendu" : auction.status === "cancelled" ? "Annulée" : "Adjugé"}
                  </span>
                )}
              </div>
              <h1
                className={`mt-3 text-[26px] font-extrabold leading-[1.12] tracking-tight text-foreground ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {property.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4 text-gold" strokeWidth={2} />
                  {property.governorate}
                </span>
                <span aria-hidden className="opacity-30">·</span>
                <span className="batta-tabular font-mono text-[11px] uppercase tracking-[0.12em]">Lot {lotNo}</span>
                {totalBids > 0 && (
                  <>
                    <span aria-hidden className="opacity-30">·</span>
                    <span className="batta-tabular">{totalBids} {t("auction.totalBids")}</span>
                  </>
                )}
              </div>
              {facts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {facts.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[12px] font-bold text-foreground ring-1 ring-border">
                      <f.Icon className="size-3.5 text-gold" strokeWidth={2} /> {f.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Buy box — direct sale uses its own panel; auctions use the price card */}
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
              <div className="rounded-2xl bg-surface p-6 ring-1 ring-border shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="batta-eyebrow inline-flex items-center gap-2">
                    {isLive && <span className="size-1.5 rounded-full bg-gold pulse-gold" />}
                    {isEnded ? "Résultat" : isLive ? t("auction.currentBid") : "Mise à prix"}
                  </span>
                  <div className="batta-tabular text-[10px] text-muted">
                    dès {formatTND(auction.opening_price, locale)} {tnd}
                  </div>
                </div>
                <div
                  className={`batta-tabular gradient-gold-text mt-2 text-[40px] font-extrabold leading-none tracking-tight ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  {formatTND(
                    isEnded && auction.winner_amount ? Number(auction.winner_amount) : currentPrice,
                    locale,
                  )}
                  <span className="ms-2 text-[13px] font-bold uppercase tracking-[0.16em] text-gold/80">{tnd}</span>
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
                      <div className="batta-eyebrow text-[9px]">
                        {showStart ? t("auction.startsIn") : t("auction.endsIn")}
                      </div>
                      <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                        <Countdown endsAt={showStart ? (auction.starts_at as string) : auction.ends_at} />
                      </div>
                    </div>
                    <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-border">
                      <div className="batta-eyebrow text-[9px]">{t("auction.depositRequired")}</div>
                      <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                        {depositRequired ? `${formatTND(deposit, locale)} ${tnd}` : "Gratuit"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Primary CTA */}
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
                          {formatTND(Number(auction.buy_now_price), locale)} {tnd}
                        </span>
                      </Link>
                    )}
                  </div>
                )}

                {/* Winner shortcut */}
                {!showBidCta && isWinner && (
                  <Link
                    href={{ pathname: "/account/activity", query: { tab: "gagnees" } }}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--gold-faint)] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--gold)] ring-1 ring-[var(--gold-soft)] transition hover:underline"
                  >
                    <Trophy className="size-4" strokeWidth={2.2} /> {t("auction.myWins")} →
                  </Link>
                )}

                {/* Reassurance + calendar */}
                {!isEnded && (
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                      <ShieldCheck className="size-3.5 text-gold" strokeWidth={2} />
                      {depositRequired ? "Caution remboursable" : "Sans caution"}
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

      {/* ── FULL-WIDTH DETAIL SECTIONS ── */}

      {/* Specifications */}
      <section className="batta-frame mt-10 p-6">
        <h2 className="batta-eyebrow flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Caractéristiques
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {specs.map((s) => (
            <Spec key={s.key} Icon={specIcon(s.key)} label={s.label} value={s.value} />
          ))}
        </div>
      </section>

      {/* Description */}
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

      {/* Map */}
      {property.lat != null && property.lng != null && (
        <div className="mt-6 [&>section]:!mx-0 [&>section]:!mt-0">
          <PropertyMap
            lat={Number(property.lat)}
            lng={Number(property.lng)}
            address={property.address ?? property.governorate}
          />
        </div>
      )}

      {/* Inspection + Documents */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        {myInspection ? (
          <section className="batta-surface-ivory flex items-center gap-3 rounded-2xl p-5">
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
          <section className="batta-surface-ivory flex items-center gap-3 rounded-2xl p-5">
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

        <section className="batta-frame p-6">
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
