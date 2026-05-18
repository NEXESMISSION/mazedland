import { notFound } from "next/navigation";
import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty } from "@/lib/types";
import { formatTND, depositForOpening } from "@/lib/utils";
import { propertyPhotoUrl, isStaticSeedPath } from "@/lib/imageUrl";
import { Countdown } from "@/components/auction/Countdown";
import { DirectSalePanel } from "@/components/auction/DirectSalePanel";
import { SixthOfferForm } from "@/components/auction/SixthOfferForm";
import { HeroCarousel } from "@/components/auction/HeroCarousel";
import { PropertyMap } from "@/components/property/PropertyMap";
import { Link } from "@/i18n/navigation";
import {
  MapPin, Ruler, BedDouble, Bath, Building2, Calendar,
  ShieldCheck, ClipboardCheck, FileText, Lock, Gavel, Download,
} from "lucide-react";

/**
 * Auction detail — black + gold dark mode, ported to the mazed-auto
 * detail-page rhythm. Cinematic photo at top with the lot identity
 * over it, then a navy luxe price card with the trophy figure in
 * gradient-gold, the interactive bid panel, specs, provenance,
 * inspection CTA, documents.
 */
export default async function AuctionDetail({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const supabase = await getServerSupabase();

  const [auctionRes, userRes, bidCountRes] = await Promise.all([
    supabase
      .from("auctions")
      .select(`
        *,
        property:properties (
          *,
          photos:property_photos (id, storage_path, sort_order, caption)
        )
      `)
      .eq("id", id)
      .single(),
    supabase.auth.getUser(),
    // Total count bypasses sealed-bid amount RLS (head only returns the
    // row count, no masked-amount column) so we can show "X offres" on
    // every auction type without leaking sealed amounts.
    supabase
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq("auction_id", id),
  ]);

  if (auctionRes.error || !auctionRes.data) notFound();

  const auction = auctionRes.data as unknown as AuctionWithProperty;
  const totalBids = bidCountRes.count ?? 0;
  const property = auction.property;
  const photos = property.photos?.sort((a, b) => a.sort_order - b.sort_order) ?? [];
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();

  // Documents: pull from the public `property_document_kinds` view so
  // unauthenticated browsers see the count + types (social proof). The
  // actual PDF download still goes through /api/property/document/[id]
  // which goes through the protected `property_documents` RLS.
  const { data: docsRows } = await supabase
    .from("property_document_kinds")
    .select("id, kind")
    .eq("property_id", property.id);
  const documents = (docsRows ?? []) as Array<{ id: string; kind: string }>;
  const userId = userRes.data.user?.id ?? null;
  const currentPrice = auction.current_price ?? auction.opening_price;
  const deposit = depositForOpening(auction.opening_price);
  const isLive = auction.status === "live" || auction.status === "extending";
  // listing_type='direct' → fixed-price sale, no bidding. DirectSalePanel
  // owns the price + CTA; we skip the auction price card and bid CTA below.
  const isDirect = auction.listing_type === "direct";
  const hasBuyNow = !isDirect && auction.buy_now_price != null;

  // Pre-flight gates the bid panel needs to render the right CTA
  // without a client-side round-trip. KYC + active deposit are
  // server-truth; the panel uses these to choose between "Sign in",
  // "Verify identity", "Pay deposit", and the actual bid form.
  let kycVerified = false;
  let hasActiveDeposit = false;
  if (userId) {
    const [profileRes, depositRes] = await Promise.all([
      supabase.from("profiles").select("kyc_status").eq("id", userId).single(),
      supabase
        .from("auction_deposits")
        .select("id")
        .eq("auction_id", id)
        .eq("user_id", userId)
        .is("released_at", null)
        .is("forfeited_at", null)
        .maybeSingle(),
    ]);
    kycVerified = profileRes.data?.kyc_status === "verified";
    hasActiveDeposit = !!depositRes.data;
  }
  const isOwner = userId !== null && userId === property.owner_id;

  let myInspection: { id: string; status: string } | null = null;
  if (userId) {
    const { data: ins } = await supabase
      .from("inspections")
      .select("id, status")
      .eq("property_id", property.id)
      .eq("requested_by", userId)
      .in("status", ["submitted", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    myInspection = ins ?? null;
  }

  // While the auction is live, the "Placer une enchère" CTA detaches
  // from the document flow and floats above the bottom tab bar — always
  // visible, no scrolling required. We reserve room for it via extra
  // bottom padding so the last card isn't covered.
  const showFloatingBidCta = !isDirect && isLive;

  return (
    <div
      className={`mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)] ${
        showFloatingBidCta ? "pb-32" : "pb-8"
      }`}
    >
      {/* ─── PHOTO GALLERY — full-bleed cinematic hero with auto-rotate ─── */}
      <HeroCarousel photos={photos} alt={property.title}>
        {/* Top row — LIVE pulse + lot chip + verified */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex items-start justify-between gap-2 px-3">
          <div className="flex flex-wrap items-center gap-2">
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-[0_0_18px_rgba(239,68,68,0.55)]">
                <span className="batta-pulse-dot size-1.5 rounded-full bg-white text-white/40" />
                {t("auction.live")}
              </span>
            )}
            <span className="batta-tabular inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur-md">
              Lot · {lotNo}
            </span>
            <span className="batta-gold-fill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
              <ShieldCheck className="size-3" strokeWidth={2.5} />
              {t("auction.verified")}
            </span>
          </div>
          <span className="batta-tabular pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-md">
            {totalBids} · {t("auction.totalBids")}
          </span>
        </div>

        {/* Bottom overlay — type pill + bold title + location. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-5 pb-12 pt-16">
          <span className="batta-gold-fill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
            <Gavel className="size-3" strokeWidth={2.5} />
            {t(`auction.types.${auction.type}`)}
          </span>
          <h1
            className={`mt-3 text-pretty text-[28px] font-extrabold leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {property.title}
          </h1>
          <div className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
            <MapPin className="size-3.5" strokeWidth={2} />
            <span className="truncate">
              {property.governorate}
              {property.delegation ? ` · ${property.delegation}` : ""}
            </span>
          </div>
        </div>
      </HeroCarousel>

      {/* Thumbnails — horizontal contact-sheet rail. Next/Image with
          explicit small width so the optimizer hands back ~80px-wide
          variants instead of the full-res original (often 1500×1000+). */}
      {photos.length > 1 && (
        <div className="snap-rail hide-scrollbar flex gap-2 overflow-x-auto px-4 pt-3">
          {photos.slice(1, 8).map((p) => {
            const src = propertyPhotoUrl(p.storage_path);
            return (
              <Image
                key={p.id}
                src={src}
                alt=""
                width={80}
                height={80}
                sizes="80px"
                unoptimized={isStaticSeedPath(src)}
                className="aspect-square w-20 shrink-0 snap-start rounded-xl object-cover ring-1 ring-border transition hover:ring-gold/50"
              />
            );
          })}
        </div>
      )}

      {/* ─── DIRECT-SALE PANEL — replaces the auction price card + bid CTA
              when the listing is a fixed-price direct sale ─── */}
      {isDirect && (
        <DirectSalePanel
          auction={auction}
          userId={userId}
          kycVerified={kycVerified}
          isOwner={isOwner}
          locale={locale}
        />
      )}

      {/* ─── HEADLINE PRICE + COUNTDOWN — auctions only ─── */}
      {!isDirect && (
      <section className="batta-surface-navy-luxe relative mx-4 mt-5 overflow-hidden rounded-2xl ring-1 ring-gold/25">
        <div className="relative p-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="batta-eyebrow inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-gold pulse-gold" />
              {t("auction.currentBid")}
            </span>
            <div className="batta-tabular text-[10px] text-muted">
              from {formatTND(auction.opening_price, locale)} {t("common.tnd")}
            </div>
          </div>
          <div
            className={`batta-tabular gradient-gold-text mt-2 text-[44px] font-extrabold leading-none tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {formatTND(currentPrice, locale)}
            <span className="ms-2 text-[14px] font-bold uppercase tracking-[0.16em] text-gold/80">
              {t("common.tnd")}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-gold/15">
              <div className="batta-eyebrow text-[9px]">{t("auction.endsIn")}</div>
              <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                <Countdown endsAt={auction.ends_at} />
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-gold/15">
              <div className="batta-eyebrow text-[9px]">{t("auction.depositRequired")}</div>
              <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                {formatTND(deposit, locale)} {t("common.tnd")}
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* ─── PURCHASE STATUS — auctions only, post-live states ───
              The active "Placer une enchère" CTA is rendered as a
              floating bottom bar at the end of this component so it
              stays visible while the user scrolls through specs,
              provenance, the map, and documents. */}
      {!isDirect && !isLive && (
      <section className="mx-4 mt-3 space-y-2">
        {auction.winner_user_id && userId === auction.winner_user_id ? (
          <div className="flex items-center justify-between gap-3 py-2 px-1">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--gold)]">
                Adjugé · vous avez gagné
              </div>
              <div className="batta-tabular mt-0.5 text-base font-bold text-foreground">
                {formatTND(Number(auction.winner_amount ?? currentPrice), locale)}
              </div>
            </div>
            <Link
              href="/account/wins"
              className="shrink-0 text-[12px] font-semibold text-[var(--gold)] hover:underline"
            >
              Mes acquisitions →
            </Link>
          </div>
        ) : (
          <div className="text-center text-[12px] text-[var(--foreground-muted)] py-2">
            Enchère terminée
          </div>
        )}
      </section>
      )}

      {/* ─── SIXTH-OFFER WINDOW (Tunisian-law 1/6 rule) ─── */}
      {auction.status === "sixth_offer_window"
        && auction.winner_amount
        && auction.sixth_offer_deadline
        && !isOwner && (
        <SixthOfferForm
          auctionId={auction.id}
          winningAmount={Number(auction.winner_amount)}
          deadline={auction.sixth_offer_deadline}
          loggedIn={userId !== null}
          kycVerified={kycVerified}
          hasActiveDeposit={hasActiveDeposit}
        />
      )}

      {/* ─── SPECIFICATIONS ─── */}
      <section className="mx-4 mt-6">
        <h2 className="batta-eyebrow flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Specifications
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Spec Icon={Building2} label={t("property.type")} value={t(`property.types.${property.type}`)} />
          {property.area_sqm != null && (
            <Spec Icon={Ruler} label={t("property.area")} value={`${property.area_sqm} m²`} />
          )}
          {property.rooms != null && (
            <Spec Icon={BedDouble} label={t("property.rooms")} value={String(property.rooms)} />
          )}
          {property.bathrooms != null && (
            <Spec Icon={Bath} label={t("property.bathrooms")} value={String(property.bathrooms)} />
          )}
          {property.floor != null && (
            <Spec Icon={Building2} label={t("property.floor")} value={String(property.floor)} />
          )}
          {property.year_built != null && (
            <Spec Icon={Calendar} label={t("property.yearBuilt")} value={String(property.year_built)} />
          )}
        </div>
      </section>

      {/* ─── DESCRIPTION ─── */}
      {property.description && (
        <section className="batta-frame mx-4 mt-5 p-5">
          <h2 className="batta-eyebrow flex items-center gap-2">
            <span aria-hidden className="batta-gold-rule-short" />
            Provenance
          </h2>
          <p
            className={`mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/85 ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {property.description}
          </p>
        </section>
      )}

      {/* ─── MAP ─── */}
      {property.lat != null && property.lng != null && (
        <PropertyMap
          lat={Number(property.lat)}
          lng={Number(property.lng)}
          address={property.address ?? `${property.governorate}${property.delegation ? " · " + property.delegation : ""}`}
        />
      )}

      {/* ─── INSPECTION CTA / REPORT ─── */}
      {myInspection ? (
        <section className="batta-surface-ivory mx-4 mt-4 flex items-center gap-3 rounded-xl p-4">
          <span className="batta-monogram batta-monogram-filled size-10 shrink-0">
            <ClipboardCheck className="size-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="batta-eyebrow">Inspection</div>
            <div className="mt-0.5 text-[15px] font-bold text-foreground">
              {t("property.inspectionReport")}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              Status: {myInspection.status}
            </div>
          </div>
          <a
            href={`/api/inspector/report/${myInspection.id}`}
            target="_blank" rel="noopener noreferrer"
            className="batta-btn-luxe tap-target shrink-0 px-4 py-2 text-[11.5px]"
          >
            Open
          </a>
        </section>
      ) : (
        <section className="batta-surface-ivory mx-4 mt-4 flex items-center gap-3 rounded-xl p-4">
          <span className="batta-monogram size-10 shrink-0">
            <ClipboardCheck className="size-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="batta-eyebrow">Pre-bid</div>
            <div className="mt-0.5 text-[15px] font-bold text-foreground">
              {t("property.requestInspection")}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              Independent report from an accredited inspector.
            </div>
          </div>
          <Link
            href={`/inspectors/book?property=${property.id}` as `/inspectors/book`}
            className="batta-btn-luxe tap-target shrink-0 px-4 py-2 text-[11.5px]"
          >
            Book
          </Link>
        </section>
      )}

      {/* ─── DOCUMENTS ─── */}
      <section className="batta-frame mx-4 mt-4 p-5">
        <h2 className="batta-eyebrow flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Catalogue · documents
        </h2>
        <h3 className="mt-1 flex items-center gap-2 text-[16px] font-bold text-foreground">
          <FileText className="size-4 text-gold" strokeWidth={2} />
          {t("property.documents")}
        </h3>
        <p className="mt-1.5 text-[11px] text-muted">
          {t("auction.depositRequired_long")}
        </p>
        <ul className="mt-3 divide-y divide-border">
          {documents.length === 0 && (
            <li className="py-3 text-[12px] text-muted">No documents uploaded yet.</li>
          )}
          {documents.map((d) => {
            const canDownload = isOwner || (kycVerified && hasActiveDeposit);
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[13px] text-foreground/85">{d.kind}</span>
                {canDownload ? (
                  <a
                    href={`/api/property/document/${d.id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="batta-gold-fill inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] shadow-[var(--shadow-gold)]"
                  >
                    <Download className="size-3" strokeWidth={2.5} />
                    PDF
                  </a>
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

      {/* Spacer above the bottom tab bar so the last card isn't covered. */}
      <div aria-hidden className="h-6" />

      {/* ─── FLOATING BID CTA ───
              Sticks to the bottom of the viewport, sitting just above
              the global BottomTabBar (which is `--batta-bottombar-h`
              tall, plus the iOS safe area). Stays visible for the
              entire scroll of the detail page so the primary action
              is one tap away. */}
      {showFloatingBidCta && (
        <div
          className="fixed inset-x-0 z-40 px-4"
          style={{
            bottom: "calc(var(--batta-bottombar-h) + env(safe-area-inset-bottom) + 12px)",
          }}
        >
          <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
            <div className="rounded-2xl border border-border bg-white/95 p-3 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.25)] backdrop-blur-xl">
              <Link
                href={`/auctions/${auction.id}/bid` as never}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--gold)] text-[14px] font-bold text-white shadow-[var(--shadow-gold)] transition-all hover:bg-[var(--gold-bright)] active:scale-[0.99]"
              >
                <Gavel className="h-4 w-4" strokeWidth={2.5} />
                Placer une enchère
              </Link>
              {hasBuyNow && !isOwner && (
                <Link
                  href={`/auctions/${auction.id}/bid` as never}
                  className="mt-1.5 block py-1 text-center text-[12px] text-[var(--foreground-muted)] hover:text-[var(--gold)]"
                >
                  ou achat immédiat à{" "}
                  <span className="font-bold text-foreground">
                    {formatTND(Number(auction.buy_now_price), locale)}
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Spec({
  Icon, label, value,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface p-3 ring-1 ring-border">
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
