import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty } from "@/lib/types";
import { formatTND } from "@/lib/utils";
import { parseMonetizationSettings, resolveDeposit } from "@/lib/pricing";
import { Countdown } from "@/components/auction/Countdown";
import { AuctionCalendarMenu } from "@/components/auction/AuctionCalendarMenu";
import { DirectSalePanel } from "@/components/auction/DirectSalePanel";
import { HeroCarousel } from "@/components/auction/HeroCarousel";
import { AuctionPresencePing } from "@/components/auction/AuctionPresencePing";
import { SellerAuctionBanner } from "@/components/auction/SellerAuctionBanner";
import { AuctionDesktop } from "@/components/auction/AuctionDesktop";
import { PropertyMap } from "@/components/property/PropertyMap";
import { PropertyDocumentOpenButton } from "@/components/property/PropertyDocumentOpenButton";
import { Link } from "@/i18n/navigation";
import {
  MapPin, Ruler, BedDouble, Bath, Building2, Calendar,
  ShieldCheck, ClipboardCheck, FileText, Lock, Gavel, Download, Clock,
  Hourglass,
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

  const [auctionRes, userRes, bidCountRes, depRowRes] = await Promise.all([
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
    // Deposit settings are global + independent of the auction row, so they
    // ride in this first parallel wave instead of a later sequential await.
    supabase.from("app_settings").select("value").eq("key", "deposit").maybeSingle(),
  ]);

  if (auctionRes.error || !auctionRes.data) {
    // An auction the user was watching / bidding on can disappear (admin
    // cancel + scrub, hard-delete from /admin/properties). Old bell rows
    // baked `/auctions/<id>` into their link, so without this recovery
    // a tapped notification dead-ends on a 404 with no way back to the
    // user's other activity. Authenticated users land on their activity
    // hub (with ?focus= so the old row, if still there, gets ringed);
    // anonymous viewers get the regular 404 since the recovery target
    // requires a session.
    const user = userRes.data.user;
    if (user) {
      redirect({
        href: `/account/activity?focus=${encodeURIComponent(id)}`,
        locale: locale as "ar" | "fr" | "en",
      });
    }
    notFound();
  }

  const auction = auctionRes.data as unknown as AuctionWithProperty;
  const totalBids = bidCountRes.count ?? 0;
  const property = auction.property;
  const photos = property.photos?.sort((a, b) => a.sort_order - b.sort_order) ?? [];
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();

  // Documents: pull from the public `property_document_kinds` view so
  // unauthenticated browsers see the count + types (social proof). The
  // actual PDF download still goes through /api/property/document/[id]
  // which goes through the protected `property_documents` RLS.
  // Property docs + per-type characteristics catalog are independent of each
  // other (and of the user gates below) — fetch them in one parallel wave.
  const [docsRes, attrKindRes] = await Promise.all([
    supabase
      .from("property_document_kinds")
      .select("id, kind")
      .eq("property_id", property.id),
    // Per-type characteristics catalog → drives the Specifications tiles.
    // The attributes JSONB is the source of truth; rows created before
    // migration 0037 only have the legacy columns, so we backfill the
    // canonical keys from those so old listings still show their specs.
    supabase
      .from("property_attribute_kinds")
      .select("field_key, label, data_type, options, unit, sort_order")
      .eq("property_type", property.type)
      .order("sort_order")
      .order("label"),
  ]);
  const documents = (docsRes.data ?? []) as Array<{ id: string; kind: string }>;
  const attrKinds = (attrKindRes.data ?? []) as Array<{
    field_key: string;
    label: string;
    data_type: string;
    options: { value: string; label: string }[] | null;
    unit: string | null;
  }>;
  const attrs: Record<string, string | number | boolean> = {
    ...(property.attributes ?? {}),
  };
  const legacyCols: Record<string, number | null> = {
    area_sqm: property.area_sqm,
    rooms: property.rooms,
    bathrooms: property.bathrooms,
    floor: property.floor,
    year_built: property.year_built,
  };
  for (const [k, v] of Object.entries(legacyCols)) {
    if (attrs[k] == null && v != null) attrs[k] = v;
  }

  const userId = userRes.data.user?.id ?? null;
  const currentPrice = auction.current_price ?? auction.opening_price;
  // Deposit is admin-configurable (free / fixed / percent + free window).
  // Settings came back in the first parallel wave (depRowRes).
  const depCfg = parseMonetizationSettings(
    new Map<string, unknown>([["deposit", depRowRes.data?.value]]),
  ).deposit;
  const { required: depositRequired, amount: deposit } = resolveDeposit(
    depCfg, auction.opening_price,
  );
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
  let depositUnderReview = false;
  let myInspection: { id: string; status: string } | null = null;
  if (userId) {
    const [profileRes, depositRes, pendRes, insRes] = await Promise.all([
      supabase.from("profiles").select("kyc_status").eq("id", userId).single(),
      supabase
        .from("auction_deposits")
        .select("id")
        .eq("auction_id", id)
        .eq("user_id", userId)
        .is("released_at", null)
        .is("forfeited_at", null)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id")
        .eq("user_id", userId)
        .eq("auction_id", id)
        .eq("kind", "deposit_lock")
        .eq("status", "pending_review")
        .limit(1),
      // Viewer's own inspection on this property — folded into the same
      // userId-gated wave instead of a separate round-trip below.
      supabase
        .from("inspections")
        .select("id, status")
        .eq("property_id", property.id)
        .eq("requested_by", userId)
        .in("status", ["submitted", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    kycVerified = profileRes.data?.kyc_status === "verified";
    hasActiveDeposit = !!depositRes.data;
    depositUnderReview = (pendRes.data?.length ?? 0) > 0;
    myInspection = (insRes.data as { id: string; status: string } | null) ?? null;
  }
  const isOwner = userId !== null && userId === property.owner_id;

  // Seller-fork data — fetched only when the viewer owns this listing. Tells
  // us what to surface in the "Tableau du vendeur" banner: how much the
  // winning buyer has actually paid, and how many active bidders are
  // sitting on deposits (proxy for "real interest"). Cheap pair of queries
  // gated on isOwner so non-owners pay nothing.
  let sellerFinalPayment: { id: string; status: string; amount: number } | null = null;
  let sellerActiveDeposits = 0;
  if (isOwner) {
    const [finalPayRes, depCountRes] = await Promise.all([
      supabase
        .from("payments")
        .select("id, status, amount")
        .eq("auction_id", id)
        .in("kind", ["final_payment", "buy_now"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("auction_deposits")
        .select("id", { count: "exact", head: true })
        .eq("auction_id", id)
        .is("released_at", null)
        .is("forfeited_at", null),
    ]);
    if (finalPayRes.data) {
      sellerFinalPayment = {
        id: finalPayRes.data.id as string,
        status: finalPayRes.data.status as string,
        amount: Number(finalPayRes.data.amount),
      };
    }
    sellerActiveDeposits = depCountRes.count ?? 0;
  }

  // The "Placer une enchère" CTA detaches from the document flow and
  // floats above the bottom tab bar — always visible, no scrolling
  // required. We show it for every biddable state (scheduled, live,
  // extending) so the action is reachable even before the server-side
  // cron flips a just-opened auction's status to `live`. The bid page
  // itself handles the "not yet open" / "already ended" banners. We
  // reserve room for the floating bar via extra bottom padding so the
  // last in-flow card isn't covered.
  const isEnded =
    auction.status === "ended_sold" ||
    auction.status === "ended_unsold" ||
    auction.status === "awarded" ||
    auction.status === "cancelled" ||
    auction.status === "sixth_offer_window";
  // Owners can land on their own auction but should never see the
  // bid CTA — there's a server-side guard on /bid that already blocks
  // them, and showing the button just to gate it later is confusing.
  const showFloatingBidCta = !isDirect && !isEnded && !isOwner;

  return (
    <>
      {/* Suppress "you've been outbid" notifications while the user
          has this page open. The DB place_bid RPC skips the push when
          the bidder has pinged auction_presence in the last 45s; that
          ping previously fired only from the bid page, so anyone
          sitting on the detail page still got spammed with outbid
          notifications they could already see live. */}
      <AuctionPresencePing auctionId={auction.id} userId={userId} />

      {/* ─── DESKTOP (lg+) — clean two-column layout in its own file so
              the mobile tree below is never touched. ─── */}
      <AuctionDesktop
        auction={auction}
        totalBids={totalBids}
        currentPrice={currentPrice}
        depositRequired={depositRequired}
        deposit={deposit}
        isLive={isLive}
        isDirect={isDirect}
        hasBuyNow={hasBuyNow}
        isEnded={isEnded}
        isOwner={isOwner}
        kycVerified={kycVerified}
        hasActiveDeposit={hasActiveDeposit}
        depositUnderReview={depositUnderReview}
        userId={userId}
        documents={documents}
        attrKinds={attrKinds}
        attrs={attrs}
        myInspection={myInspection}
        sellerFinalPayment={sellerFinalPayment}
        sellerActiveDeposits={sellerActiveDeposits}
      />

      {/* ─── MOBILE / tablet (default, hidden on lg+) ─── */}
      <div
        className={`lg:hidden mx-auto max-w-[var(--max-w)] ${
          showFloatingBidCta ? "pb-48" : "pb-8"
        }`}
      >

      {/* ─── PHOTO GALLERY — full-bleed cinematic hero with auto-rotate ─── */}
      <HeroCarousel photos={photos} alt={property.title}>
        {/* Top row — just LIVE/status on the left, bid count on the
            right. LOT and the "Vérifié" badge used to sit here too,
            but four pills in a row was too busy on phones. LOT now
            lives in the bottom meta row (it's a reference number, not
            a callout); verification is implicit at the platform
            level and shown more carefully inside the body via the
            inspector + KYC sections. */}
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

        {/* Bottom overlay — type pill + bold title + location · lot. */}
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
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" strokeWidth={2} />
              <span className="truncate">{property.governorate}</span>
            </span>
            <span aria-hidden className="opacity-40">·</span>
            <span className="batta-tabular font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/65">
              Lot {lotNo}
            </span>
          </div>
        </div>
      </HeroCarousel>

      {/* (Thumbnails now live inside HeroCarousel — clickable, in sync with
          the slider — so there's no separate static rail here.) */}

      {/* ─── SELLER BANNER ───
              Replaces buyer-centric framing when the viewer owns this
              listing. Sellers land here from seller_received_bid /
              auction_sold_seller / auction_finalized_seller notifications,
              and previously saw the same "place your bid" UI a bidder
              would — confusing, because they can't bid. This banner
              surfaces what matters to them instead: current bid + depth,
              status (live / sold / unsold), buyer payment state when
              sold, and direct links to manage the listing and follow
              payouts. */}
      {isOwner && (
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
      <section className="relative mx-4 mt-5 overflow-hidden rounded-[26px] bg-gradient-to-br from-[var(--gold-faint)] to-white ring-1 ring-[var(--gold)]/25 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.4)]">
        <div className="relative p-6">
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
            className={`batta-tabular gradient-gold-text mt-2 text-[44px] font-extrabold leading-none tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {formatTND(
              isEnded && auction.winner_amount
                ? Number(auction.winner_amount)
                : currentPrice,
              locale,
            )}
            <span className="ms-2 text-[14px] font-bold uppercase tracking-[0.16em] text-gold/80">
              {t("common.tnd")}
            </span>
          </div>

          {/* Ended → a single clear result line. Live/scheduled → the
              countdown + deposit the bidder still needs. */}
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
              <div className="rounded-2xl bg-white/80 px-3.5 py-3 ring-1 ring-[var(--gold)]/15 backdrop-blur">
                {/* Pre-live: count down to the start, so a seller who set
                    a time range immediately sees when the auction opens.
                    Once it's live, the same tile counts down to the end. */}
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
              <div className="rounded-2xl bg-white/80 px-3.5 py-3 ring-1 ring-[var(--gold)]/15 backdrop-blur">
                <div className="batta-eyebrow text-[9px]">{t("auction.depositRequired")}</div>
                <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                  {depositRequired ? `${formatTND(deposit, locale)} ${t("common.tnd")}` : "Gratuit"}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {/* Calendar reminder — its own row OUTSIDE the price card. The
          card uses overflow-hidden to clip its gradient inner; that was
          also clipping the calendar dropdown panel and the bottom-half
          of the button itself. Sitting in a sibling row gives the menu
          room to open downward without fighting the card's clip. */}
      {!isDirect && (
        <div className="mx-4 mt-3 flex justify-end">
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

      {/* ─── "You won" row — only for the winner. The generic ended state
              is already shown in the price card above, so non-winners get
              nothing extra here. ─── */}
      {!isDirect
        && auction.winner_user_id
        && userId === auction.winner_user_id && (
        <section className="mx-4 mt-3">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--gold-faint)] px-4 py-3 ring-1 ring-[var(--gold-soft)]">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--gold)]">
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
        </section>
      )}

      {/* ─── SIXTH-OFFER WINDOW (Tunisian-law 1/6 rule) ───
            Quiet pointer for the provisional winner. The action — the
            actual form — now lives on /auctions/[id]/bid where every
            other bidding action lives, so the detail page stays a
            "browse and understand" surface. Visible only to the
            provisional winner (same audience the form had). */}
      {auction.status === "sixth_offer_window"
        && auction.winner_amount
        && auction.sixth_offer_deadline
        && !isOwner
        && userId !== null
        && auction.winner_user_id === userId && (
        <section className="mx-4 mt-3">
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
        </section>
      )}

      {/* ─── SPECIFICATIONS ─── */}
      <section className="mx-4 mt-6">
        <h2 className="batta-eyebrow flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Caractéristiques
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Spec Icon={Building2} label={t("property.type")} value={t(`property.types.${property.type}`)} />
          {attrKinds.map((k) => {
            const raw = attrs[k.field_key];
            // Skip empties and unchecked booleans (we only stored `true`).
            if (raw == null || raw === "" || raw === false) return null;
            let value: string;
            if (k.data_type === "boolean") {
              value = "Oui";
            } else if (k.data_type === "select") {
              value =
                k.options?.find((o) => o.value === raw)?.label ?? String(raw);
            } else {
              value = k.unit ? `${raw} ${k.unit}` : String(raw);
            }
            return (
              <Spec
                key={k.field_key}
                Icon={specIcon(k.field_key)}
                label={k.label}
                value={value}
              />
            );
          })}
        </div>
      </section>

      {/* ─── DESCRIPTION ─── */}
      {property.description && (
        <section className="batta-frame mx-4 mt-5 p-5">
          <h2 className="batta-eyebrow flex items-center gap-2">
            <span aria-hidden className="batta-gold-rule-short" />
            Description
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
          address={property.address ?? property.governorate}
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
              Statut : {myInspection.status}
            </div>
          </div>
          <a
            href={`/api/inspector/report/${myInspection.id}`}
            target="_blank" rel="noopener noreferrer"
            className="batta-btn-luxe tap-target shrink-0 px-4 py-2 text-[11.5px]"
          >
            Ouvrir
          </a>
        </section>
      ) : (
        <section className="batta-surface-ivory mx-4 mt-4 flex items-center gap-3 rounded-xl p-4">
          <span className="batta-monogram size-10 shrink-0">
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
            className="batta-btn-luxe tap-target shrink-0 px-4 py-2 text-[11.5px]"
          >
            Réserver
          </Link>
        </section>
      )}

      {/* ─── DOCUMENTS ─── */}
      <section className="batta-frame mx-4 mt-4 p-5">
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
          // z-50 so we sit ABOVE the global BottomTabBar (z-40) and its
          // centered FAB (which is `-translate-y-5` and would otherwise
          // overlap the bid button on phones).
          //
          // bottom offset clears the FAB's lifted disc:
          //   tab_bar_h + safe_area + FAB_lift (~24px) + breathing room (12px)
          // ≈ var(--batta-bottombar-h) + safe-area + 36px.
          className="fixed inset-x-0 z-50 px-4"
          style={{
            bottom:
              "calc(var(--batta-bottombar-h) + env(safe-area-inset-bottom) + 36px)",
          }}
        >
          <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
            {/* No wrapping white card any more — the gold button carries
                its own gradient + shadow, and a translucent backdrop
                under it felt like an extra surface fighting the page.
                The optional buy-now link below gets its own small dark
                glass pill so the text stays readable when it floats
                over arbitrary listing photography. */}
            {depositUnderReview && !hasActiveDeposit ? (
              // Receipt already sent — don't prompt to pay again. Calm
              // "we're checking it" pill that links to the payment status.
              <Link
                href="/account/payments"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-amber-300 bg-amber-50 text-[13.5px] font-bold text-amber-700 shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)] transition-all active:scale-[0.99]"
              >
                <Clock className="h-4 w-4" strokeWidth={2.5} />
                Caution en cours de validation
              </Link>
            ) : (
              <Link
                href={`/auctions/${auction.id}/bid` as never}
                className="batta-gradient-gold inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[var(--shadow-gold)] ring-1 ring-black/5 transition-all active:scale-[0.99]"
              >
                <Gavel className="h-4 w-4" strokeWidth={2.5} />
                {isLive ? t("auction.placeBid") : "Réserver ma place"}
              </Link>
            )}
            {hasBuyNow && !isOwner && (
              <div className="mt-2 flex justify-center">
                <Link
                  // Buy-now jumps straight to the unified checkout (it
                  // does not require a deposit, so routing through the
                  // bid page's deposit gate would block a legitimate
                  // buy-now flow). Login/KYC checks happen on the
                  // checkout page itself.
                  href={`/payment/checkout?type=buy_now&auction=${auction.id}` as never}
                  className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[11.5px] text-white/85 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
                >
                  {t("auction.buyNowFor")}{" "}
                  <span className="font-bold text-white">
                    {formatTND(Number(auction.buy_now_price), locale)}
                  </span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}

// Maps an attribute field_key to a fitting icon for its spec tile. Numeric
// measures get a ruler, rooms a bed, etc.; everything else falls back to
// the building glyph.
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
    <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-b from-white to-[var(--gold-faint)] p-3 ring-1 ring-[var(--gold)]/12">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-gold ring-1 ring-[var(--gold)]/20">
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
