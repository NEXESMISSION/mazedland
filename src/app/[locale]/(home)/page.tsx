import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LiveTicker } from "@/components/landing/LiveTicker";
import { TrendingRail } from "@/components/landing/TrendingRail";
import { RecentBidsFeed } from "@/components/landing/RecentBidsFeed";
import { CoverageStrip } from "@/components/landing/CoverageStrip";
import { EndingSoonBanner } from "@/components/landing/EndingSoonBanner";
import { HeroBanner, type HeroSlide } from "@/components/landing/HeroBanner";
import { HomeDesktop } from "@/components/landing/HomeDesktop";
import { PropertyCard } from "@/components/property/PropertyCard";
import { propertyPhotoUrl, isStaticSeedPath } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty } from "@/lib/types";
import {
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Building2,
  Home,
  Trees,
  Store,
  Briefcase,
  Gavel,
  MapPin,
  Search,
  ShieldCheck,
  ClipboardCheck,
  Scale,
  Lock,
  Sparkles,
} from "lucide-react";

// Row type for the "Recently hammered" rail — declared at the top of
// the module so the LandingPage function can reference it from inside
// its `let hammered: HammeredRow[]` initialisation. (Turbopack's TS
// hoister doesn't always lift type aliases past long function bodies,
// so we put it above the use site explicitly.)
type HammeredRow = {
  id: string;
  winner_amount: number | string | null;
  hammer_at: string | null;
  type: string;
  property: {
    title: string;
    governorate: string;
    photos?: { id: string; storage_path: string; sort_order: number }[];
  };
};

/**
 * Race a promise against a deadline. The home page fans out several
 * round-trips to a remote Supabase; if one of them hangs (pooler hiccup,
 * network blip) the whole server render would stall and the route's
 * loading.tsx Suspense fallback would spin forever — the "stuck loading"
 * users hit intermittently. A timeout turns a hang into a fast fallback:
 * the page renders its brand hero + browse rails instead of freezing.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("home_data_timeout")), ms),
    ),
  ]);
}

/**
 * Landing page — black + gold dark mode, design language ported from
 * the mazed-auto home feed. Every section is grouped under a
 * `SectionDivider` (gradient hairline → icon chip → eyebrow → bold
 * Jakarta title) so the page reads as a structured feed instead of a
 * loose stack of cards.
 */
// "How it works" — 3-step buyer journey strip. Defined ABOVE
// LandingPage to dodge the Turbopack-RSC hoister bug (same reason
// StatTile lived up top): module `const` declarations defined AFTER
// the long LandingPage body sometimes fail to resolve at
// server-render time in dev.
const HOW_IT_WORKS: {
  key: string;
  eyebrowKey: string;
  titleKey: string;
  bodyKey: string;
  href: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  {
    key: "browse", eyebrowKey: "home.step1Eyebrow",
    titleKey: "home.step1Title", bodyKey: "home.step1Body",
    href: "/properties", Icon: Search,
  },
  {
    key: "verify", eyebrowKey: "home.step2Eyebrow",
    titleKey: "home.step2Title", bodyKey: "home.step2Body",
    href: "/kyc", Icon: ShieldCheck,
  },
  {
    key: "bid", eyebrowKey: "home.step3Eyebrow",
    titleKey: "home.step3Title", bodyKey: "home.step3Body",
    href: "/properties", Icon: Gavel,
  },
];

// Trust pillars — what protects the user. Anchored to the four platform
// guarantees already enforced by the server code (escrow, KYC gate,
// inspection workflow, Tunisian-law surenchère + delays).
const TRUST_PILLARS: {
  key: string;
  titleKey: string;
  bodyKey: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "escrow",     titleKey: "home.trustEscrowTitle",     bodyKey: "home.trustEscrowBody",     Icon: Lock },
  { key: "kyc",        titleKey: "home.trustKycTitle",        bodyKey: "home.trustKycBody",        Icon: ShieldCheck },
  { key: "inspection", titleKey: "home.trustInspectionTitle", bodyKey: "home.trustInspectionBody", Icon: ClipboardCheck },
  { key: "legal",      titleKey: "home.trustLegalTitle",      bodyKey: "home.trustLegalBody",      Icon: Scale },
];

// `Sparkles` is imported for a planned featured-tag pass and isn't
// referenced yet; touch it here so the strict-import lint stays happy.
const _sparklesKeepAlive = Sparkles;
void _sparklesKeepAlive;

export default async function LandingPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  // One round-trip for the listing surfaces. The smaller widgets
  // (LiveTicker, RecentBidsFeed, CoverageStrip, EndingSoonBanner) each
  // own their own queries — cheap, parallelizable, fail-soft.
  let trending: AuctionWithProperty[] = [];
  let recent: AuctionWithProperty[] = [];
  // "Offres directes" rail — fixed-price (listing_type='direct') listings,
  // surfaced on their own so buyers can browse buy-now stock apart from the
  // bidding lots.
  let offers: AuctionWithProperty[] = [];
  let hammered: HammeredRow[] = [];
  // "Nouveautés" rail — newest listings (by auction created_at), distinct
  // from trending which sorts by ends_at + paid placement. Renders as the
  // same horizontal property-card scroller so it visually parallels "Les
  // plus suivis" but answers a different intent ("what's new").
  let nouveautes: AuctionWithProperty[] = [];
  let savedIds = new Set<string>();
  let loggedIn = false;
  let liveCount = 0;
  // Desktop stat-strip figures — fetched best-effort alongside the
  // listing surfaces. Each one is just a head:exact count, so the cost
  // is one row across the wire; failure falls back to 0 silently and
  // the strip degrades to placeholders the eye glides past.
  let scheduledCount = 0;
  let soldThisMonthCount = 0;
  let coverageGovs = 0;

  try {
    await withTimeout((async () => {
    const supabase = await getServerSupabase();
    // Stat-strip helper: first day of the current month, used to count
    // the "vendu ce mois-ci" tile. Computed once and reused so the head
    // query has a stable boundary even if the render straddles midnight.
    const monthStart = (() => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    const [
      liveRes, hammeredRes, nouveautesRes, userRes,
      scheduledRes, soldMonthRes, govRes,
    ] = await Promise.all([
      supabase
        .from("auctions")
        .select(`
          *,
          property:properties!inner (
            *,
            photos:property_photos (id, storage_path, sort_order, caption)
          )
        `, { count: "exact" })
        .in("status", ["scheduled", "live", "extending"])
        .eq("property.status", "ready")
        .order("ends_at", { ascending: true })
        // Was 18. Bumped so each home rail (Trending, Offres directes,
        // the "More to explore" grid) gets enough rows to feel populated
        // and the user can actually scroll horizontally — a 6-card rail
        // doesn't read as a "rail", it reads as a row.
        .limit(40),
      // "Recently hammered" — sold auctions for social-proof. Shows
      // the actual price real properties cleared at; only data the
      // platform has that newspaper auctions don't. Bumped from 8 so
      // the horizontal scroll has weight; rail self-scales to the
      // actual count so this is a ceiling, not a target.
      supabase
        .from("auctions")
        .select(`
          id, winner_amount, hammer_at, type,
          property:properties!inner (
            title, governorate, status,
            photos:property_photos (id, storage_path, sort_order)
          )
        `)
        .in("status", ["ended_sold", "awarded"])
        .eq("property.status", "ready")
        .order("hammer_at", { ascending: false })
        .limit(24),
      // "Nouveautés" — newest live/scheduled auctions, ordered by when
      // the auction row was created. Independent query (not a slice of
      // `liveRes`) so the freshness signal isn't biased by the trending
      // sort's paid-placement bubble. Bumped to 24 to match the other
      // horizontal rails — anything sourced "by created_at desc" still
      // reads as fresh past the first dozen.
      supabase
        .from("auctions")
        .select(`
          *,
          property:properties!inner (
            *,
            photos:property_photos (id, storage_path, sort_order, caption)
          )
        `)
        .in("status", ["scheduled", "live", "extending"])
        .eq("property.status", "ready")
        .order("created_at", { ascending: false })
        .limit(24),
      supabase.auth.getUser(),
      // ── Stat strip (desktop only) — three cheap head:exact counts.
      // Scheduled-but-not-yet-live, sold this month, distinct governorates
      // among ready listings. Each falls back to 0 if Supabase errors so
      // the strip still renders zeros rather than blanking the row.
      supabase
        .from("auctions")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled"),
      supabase
        .from("auctions")
        .select("id", { count: "exact", head: true })
        .in("status", ["ended_sold", "awarded"])
        .gte("hammer_at", monthStart),
      // Distinct governorates with at least one ready property — coverage
      // proxy. We pull the column (limit guard) and dedupe client-side
      // because PostgREST doesn't expose `select distinct` directly.
      supabase
        .from("properties")
        .select("governorate")
        .eq("status", "ready")
        .limit(500),
    ]);

    const rows = (liveRes.data ?? []) as unknown as AuctionWithProperty[];
    liveCount = liveRes.count ?? rows.length;

    // Paid placements bubble to the top. promo_banner outranks
    // promo_home_featured so banner-paying sellers get the carousel
    // slot AND the trending lead. Stable in PG sort order otherwise so
    // ends_at ordering is preserved within each tier.
    rows.sort((a, b) => {
      const ap = (a.property ?? {}) as {
        promo_banner?: boolean;
        promo_home_featured?: boolean;
      };
      const bp = (b.property ?? {}) as {
        promo_banner?: boolean;
        promo_home_featured?: boolean;
      };
      const aScore = (ap.promo_banner ? 2 : 0) + (ap.promo_home_featured ? 1 : 0);
      const bScore = (bp.promo_banner ? 2 : 0) + (bp.promo_home_featured ? 1 : 0);
      return bScore - aScore;
    });

    // Surfaces:
    //   - trending rail (horizontal scroller — now self-sized to the
    //     dataset rather than capped at 8)
    //   - "More to explore" grid (rest of the dataset, 2-up)
    //
    // When there are fewer than ~12 listings we deliberately let the
    // rail and the grid OVERLAP so neither section renders empty.
    // A dev DB with 9 rows used to leave the grid showing 1 lonely
    // card; now it shows all 9 even though the rail covers the first 8.
    // Split bidding lots from fixed-price offers so each gets its own rail.
    const auctionRows = rows.filter((r) => r.listing_type !== "direct");
    // Each home rail used to cap at ~10 rows: 6 visible + a couple to
    // scroll. The user asked for "more per slider, not a fixed number" —
    // so we hand the rails the full available slice (bounded by the
    // server-side limit above) and let the snap-rail scroll absorb it.
    offers = rows.filter((r) => r.listing_type === "direct");
    // Trending shows enchères (auctions). "More to explore" stays mixed so
    // a small catalogue never renders an empty grid.
    trending = (auctionRows.length > 0 ? auctionRows : rows).slice(0, 24);
    // Reuse anything past the trending tail as the "More to explore"
    // grid. Threshold bumped so we don't leak a stray single-card grid.
    recent = rows.length >= 28 ? rows.slice(24) : rows.slice(Math.min(rows.length, 12));
    hammered = (hammeredRes.data ?? []) as unknown as HammeredRow[];
    nouveautes = (nouveautesRes.data ?? []) as unknown as AuctionWithProperty[];
    scheduledCount = scheduledRes.count ?? 0;
    soldThisMonthCount = soldMonthRes.count ?? 0;
    coverageGovs = new Set(
      (govRes.data ?? [])
        .map((r) => (r as { governorate: string | null }).governorate)
        .filter((g): g is string => typeof g === "string" && g.length > 0),
    ).size;

    loggedIn = !!userRes.data.user;
    if (loggedIn && (rows.length > 0 || nouveautes.length > 0)) {
      const ids = Array.from(
        new Set([...rows.map((r) => r.id), ...nouveautes.map((r) => r.id)]),
      );
      const { data: saves } = await supabase
        .from("watchlist")
        .select("auction_id")
        .eq("user_id", userRes.data.user!.id)
        .in("auction_id", ids);
      savedIds = new Set((saves ?? []).map((s) => s.auction_id as string));
    }
    })(), 2500);
  } catch {
    // env missing, query error, or timeout → the brand hero + browse
    // rails below still render so the page is never a frozen spinner.
    // 2.5s ceiling: longer than that and users have already bounced —
    // better to paint the fallback hero immediately and let the client
    // streams (LiveTicker, RecentBidsFeed) backfill the rails.
  }

  // Built once, shared by the mobile HeroBanner and the desktop tree
  // (which now reuses the same auto-sliding carousel).
  const heroSlides = buildHeroSlides(trending, locale, liveCount, {
    liveWord: t("home.heroLive"),
    tnd: t("common.tnd"),
    bidCta: t("home.heroBidCta"),
    browseCta: t("home.heroBrowseCta"),
    brandTitle: t("home.heroBrandTitle"),
    brandSlogan: t("brand.slogan"),
    brandEyebrow: t("home.heroBrandEyebrow", { count: liveCount }),
  });

  return (
    <>
    {/* ════════════════════════════════════════════════════════════════
        MOBILE / TABLET TREE (< lg) — preserved verbatim. The inner
        `hidden lg:*` blocks never paint here (parent is lg:hidden, and
        they're already hidden below lg), so mobile is byte-for-byte
        untouched. Desktop gets its own dedicated tree below.
        ════════════════════════════════════════════════════════════════ */}
    <div className="lg:hidden mx-auto max-w-[var(--max-w)]">
      {/* ───── HERO BANNER ─────
          Auto-advancing image carousel sourced from the top trending
          auctions. Each slide is a full-bleed property photo with the
          listing's headline + price overlaid; tap goes straight to the
          auction. Fallback brand slides kick in when the DB has nothing
          live so the carousel never renders empty. */}
      <HeroBanner slides={heroSlides} isRTL={isRTL} />

      {/* LIVE TICKER */}
      <section className="mt-5">
        <LiveTicker />
      </section>

      <div className="mt-4">
        <EndingSoonBanner />
      </div>

      {/* ══════════════════════════════════════════════════════════════
          BROWSE — the page's center of gravity. Trending rail on top
          (auto-rotating, 8 cards), live-activity feed slipped under,
          coverage strip, then a 2-col grid of the next batch. No
          repeated rail headers, no marketing-section dividers between
          listings — the cards themselves carry the page.
          ══════════════════════════════════════════════════════════════ */}

      {/* Trending rail — horizontal scroller of the top 8 hottest auctions. */}
      <section className="mt-7">
        <RailHeader
          eyebrow={t("home.trendingEyebrow")}
          title={t("home.trendingTitle")}
          countLabel={trending.length}
          ctaHref="/properties"
          ChevronEnd={ChevronEnd}
          isRTL={isRTL}
          seeAllLabel={t("home.seeAll")}
          flush
        />
        {/* Mobile: horizontal snap rail (auto-advancing). Desktop: replaced
            by a proper 4-col grid below — much better than a horizontal
            scroller when the input device is a mouse and the viewport is
            wide enough to show eight cards on one viewport-height of
            screen. */}
        <div className="lg:hidden">
          {trending.length > 0 ? (
            <TrendingRail>
              {trending.map((a, i) => (
                <div key={a.id} className="w-[230px] shrink-0 snap-start">
                  <PropertyCard
                    auction={a}
                    saved={savedIds.has(a.id)}
                    loggedIn={loggedIn}
                    priority={i < 3}
                  />
                </div>
              ))}
              <div className="w-1 shrink-0" />
            </TrendingRail>
          ) : (
            <TrendingRail>
              <TrendingSkeleton />
              <TrendingSkeleton />
              <TrendingSkeleton />
            </TrendingRail>
          )}
        </div>
        {trending.length > 0 && (
          <div className="hidden lg:grid lg:grid-cols-4 lg:gap-5 lg:px-6 lg:mt-4">
            {trending.slice(0, 8).map((a, i) => (
              <PropertyCard
                key={a.id}
                auction={a}
                saved={savedIds.has(a.id)}
                loggedIn={loggedIn}
                priority={i < 4}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── "Offres directes" rail — fixed-price (buy-now) listings, kept
          separate from the bidding lots so buyers can browse them on their
          own. Only shown when there's direct stock. */}
      {offers.length > 0 && (
        <section className="mt-7">
          <RailHeader
            eyebrow="Achat immédiat"
            title="Offres directes"
            countLabel={offers.length}
            ctaHref="/properties"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
            flush
          />
          <div className="lg:hidden">
            <TrendingRail>
              {offers.map((a, i) => (
                <div key={a.id} className="w-[230px] shrink-0 snap-start">
                  <PropertyCard
                    auction={a}
                    saved={savedIds.has(a.id)}
                    loggedIn={loggedIn}
                    priority={i < 3}
                  />
                </div>
              ))}
              <div className="w-1 shrink-0" />
            </TrendingRail>
          </div>
          <div className="hidden lg:grid lg:grid-cols-4 lg:gap-5 lg:px-6 lg:mt-4">
            {offers.slice(0, 8).map((a, i) => (
              <PropertyCard
                key={a.id}
                auction={a}
                saved={savedIds.has(a.id)}
                loggedIn={loggedIn}
                priority={i < 4}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── "Nouveautés" rail — sibling of the trending rail above,
          sorted by created_at desc instead of ends_at + paid placement.
          Same card layout so it feels familiar, different headline so
          the user understands the section answers "what's new" rather
          than "what's hottest". Only rendered when we actually have
          fresh inventory — falls back to nothing rather than empty
          skeletons because the trending rail above already absorbs the
          "we just opened" copy. */}
      {nouveautes.length > 0 && (
        <section className="mt-7">
          <RailHeader
            eyebrow={t("home.nouveautesEyebrow")}
            title={t("home.nouveautesTitle")}
            countLabel={nouveautes.length}
            ctaHref="/properties"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
            flush
          />
          <div className="lg:hidden">
            <TrendingRail>
              {nouveautes.map((a, i) => (
                <div key={a.id} className="w-[230px] shrink-0 snap-start">
                  <PropertyCard
                    auction={a}
                    saved={savedIds.has(a.id)}
                    loggedIn={loggedIn}
                    priority={i < 3}
                  />
                </div>
              ))}
              <div className="w-1 shrink-0" />
            </TrendingRail>
          </div>
          <div className="hidden lg:grid lg:grid-cols-4 lg:gap-5 lg:px-6 lg:mt-4">
            {nouveautes.slice(0, 8).map((a, i) => (
              <PropertyCard
                key={a.id}
                auction={a}
                saved={savedIds.has(a.id)}
                loggedIn={loggedIn}
                priority={i < 4}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── Second hero — same shape as the top carousel, but its
          payload is the "ending soon" continuation: trending items
          beyond the first 5, still sorted by ends_at asc. Gives the
          urgency thread a second surface lower on the page. Hidden
          when there's no second-tier urgency to show.

          Desktop: skipped entirely. The wide hero at the top of the
          page + the dedicated EndingSoonBanner already absorb the
          urgency thread on lg+; a second photo carousel here turns
          into a fourth full-width banner the user has to scroll past
          to reach the browse rails. */}
      {trending.length > 5 && (
        <div className="mt-6 lg:hidden">
          <HeroBanner
            slides={buildEndingSoonSlides(trending.slice(5, 10), locale, {
              endingSoonWord: t("home.endingSoonEyebrow"),
              tnd: t("common.tnd"),
              bidCta: t("home.heroBidCta"),
            })}
            isRTL={isRTL}
          />
        </div>
      )}

      {/* Live activity feed — header-less, runs as a quiet tape under
          the trending rail. The vertical marquee says "this place is
          alive" without needing a label. */}
      <section className="mt-6 px-4">
        <RecentBidsFeed />
      </section>

      {/* Compact coverage strip — only lit wilayas + a "+N more" pill. */}
      <section className="mt-7">
        <CoverageStrip />
      </section>

      {/* More auctions — second batch on a 2-up grid. Replaces the
          old "Featured estates" + "Recently added" duplicate sections
          (those rendered the same rows.slice as the trending rail).
          One header, one grid, the rest of the available data. */}
      {recent.length > 0 && (
        <section className="mt-9 px-4">
          <RailHeader
            title={t("home.moreToExplore")}
            ctaHref="/properties"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
            flush
          />
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {recent.map((a, i) => (
              <PropertyCard
                key={a.id}
                auction={a}
                saved={savedIds.has(a.id)}
                loggedIn={loggedIn}
                priority={i < 4}
              />
            ))}
          </div>
        </section>
      )}

      {/* Browse by type — horizontal scroll rail of compact pills.
          The old 2×3 grid had big monogram chips with empty space
          around them; this version puts the icon and label inline
          so the eye reads "category" not "tile". No borders. */}
      {/* Mobile: two stacked horizontal pill rails — fits the thumb-
          scroll rhythm and keeps each section's headline visible. */}
      <section className="mt-10 px-4 lg:hidden">
        <h3 className={`text-[15px] font-bold leading-tight ${isRTL ? "font-arabic" : ""}`}>
          {t("home.browseByType")}
        </h3>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {PROPERTY_TYPES.map((pt) => (
            <Link
              key={pt.key}
              href={`/properties?types=${pt.key}` as `/properties`}
              className="tap-target inline-flex shrink-0 snap-start items-center gap-2 rounded-full bg-surface-2 px-4 py-2.5 transition active:scale-[0.97] hover:bg-surface"
            >
              <pt.Icon className="size-4 text-gold" strokeWidth={2} />
              <span
                className={`whitespace-nowrap text-[12px] font-bold leading-none text-foreground ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {t(`property.types.${pt.key}`)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-7 px-4 lg:hidden">
        <h3 className={`text-[15px] font-bold leading-tight ${isRTL ? "font-arabic" : ""}`}>
          {t("home.browseByPrice")}
        </h3>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {PRICE_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/properties?${b.query}` as `/properties`}
              className="tap-target inline-flex shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-full bg-surface-2 px-4 py-2.5 text-[12px] font-bold leading-none text-foreground transition active:scale-[0.97] hover:bg-surface"
            >
              {isRTL ? b.labelAr : b.labelEn}
            </Link>
          ))}
        </div>
      </section>

      {/* Recently hammered — actual sold prices. Horizontal scroll rail
          so any count of real cards looks intentional (1 card scrolls,
          12 cards scroll). No padded placeholders: a "Coming soon"
          tile alongside a real sold listing reads as filler and makes
          the page feel emptier than just hiding the section would. */}
      {hammered.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between px-4">
            <h3 className={`inline-flex items-center gap-1.5 text-[15px] font-bold leading-tight ${isRTL ? "font-arabic" : ""}`}>
              <Gavel className="size-3.5 text-gold" strokeWidth={2.5} />
              {t("home.recentlyHammered")}
            </h3>
            <span className="text-[11px] text-muted">{t("home.realPrices")}</span>
          </div>
          <div className="snap-rail hide-scrollbar mt-3 flex gap-3 overflow-x-auto px-4 pb-1 lg:hidden">
            {hammered.map((h) => (
              <div key={h.id} className="w-[200px] shrink-0 snap-start">
                <HammeredCard row={h} locale={locale} isRTL={isRTL} soldLabel={t("home.soldChip")} tnd={t("common.tnd")} />
              </div>
            ))}
            <div className="w-1 shrink-0" />
          </div>
          {/* Desktop: 4-col grid of the latest 8 sold lots — proof points
              read at a glance, no horizontal scroll required when the
              hardware can show eight cards at once. */}
          <div className="hidden lg:grid lg:grid-cols-4 lg:gap-5 lg:px-6 lg:mt-4">
            {hammered.slice(0, 8).map((h) => (
              <HammeredCard
                key={h.id}
                row={h}
                locale={locale}
                isRTL={isRTL}
                soldLabel={t("home.soldChip")}
                tnd={t("common.tnd")}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── "Comment ça marche" — 3-step buyer journey strip ───
              Sits below the social-proof hammered rail because that's
              where the page momentum turns from "browse" to "act":
              once a user has seen real sold prices, the next question
              is "ok, how do I actually buy?". 3 numbered steps with
              gold monogram tiles, each linking into the relevant
              surface (properties / kyc / payment checkout). Horizontal
              snap-rail on phones; 3-up grid from lg+ so the strip
              reads at a glance on desktop. */}
      <section className="mt-10">
        <div className="px-4">
          <span className="batta-eyebrow">{t("home.howItWorksEyebrow")}</span>
          <h3
            className={`mt-1.5 text-[19px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("home.howItWorksTitle")}
          </h3>
        </div>
        <div className="snap-rail hide-scrollbar mt-4 flex gap-3 overflow-x-auto px-4 pb-1 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible">
          {HOW_IT_WORKS.map((step, i) => (
            <Link
              key={step.key}
              href={step.href as never}
              className="batta-frame group flex w-[260px] shrink-0 snap-start flex-col gap-3 rounded-2xl p-5 transition active:scale-[0.99] hover:ring-gold-soft/50 lg:w-auto"
            >
              <div className="flex items-center gap-3">
                <span className="batta-monogram batta-monogram-filled size-10 text-[15px]">
                  <step.Icon className="size-4" strokeWidth={2.2} />
                </span>
                <span className="batta-tabular text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold">
                  {String(i + 1).padStart(2, "0")} · {t(step.eyebrowKey)}
                </span>
              </div>
              <div>
                <div
                  className={`text-[15.5px] font-bold leading-tight text-foreground ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  {t(step.titleKey)}
                </div>
                <p
                  className={`mt-1 text-[12px] leading-relaxed text-muted ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  {t(step.bodyKey)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── Trust strip — what protects the buyer (and the seller).
              Same horizontal-rail rhythm as the rest of the page so it
              reads as one more rich band, not a marketing block. Four
              short cards with a gold ring + brief copy; the surfaces
              they reference (escrow, KYC, inspection, legal) are the
              same ones already enforced by the platform code. */}
      <section className="mt-10">
        <div className="px-4">
          <span className="batta-eyebrow">{t("home.trustEyebrow")}</span>
          <h3
            className={`mt-1.5 text-[19px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("home.trustTitle")}
          </h3>
        </div>
        <div className="snap-rail hide-scrollbar mt-4 flex gap-3 overflow-x-auto px-4 pb-1 lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible">
          {TRUST_PILLARS.map((p) => (
            <div
              key={p.key}
              className="batta-surface-navy-luxe relative flex w-[230px] shrink-0 snap-start flex-col gap-2.5 overflow-hidden rounded-2xl p-5 ring-1 ring-gold/25 lg:w-auto"
            >
              <span className="batta-monogram size-10 shrink-0 text-gold">
                <p.Icon className="size-4" strokeWidth={2.2} />
              </span>
              <div
                className={`text-[14px] font-bold leading-tight text-foreground ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {t(p.titleKey)}
              </div>
              <p
                className={`text-[11.5px] leading-relaxed text-muted ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {t(p.bodyKey)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Final browse band.
          Mobile: the original single-line nav band — compact, finger-
          sized chevron on the right.
          Desktop (lg+): a two-up magazine spread — large eyebrow + huge
          gradient headline + slogan on the left, three numbered
          shortcut links on the right (enchères / offres directes /
          inspections). Closes the page with the same "what can I do
          here" question the hero opens with, answered concretely. */}
      <section className="mt-10 px-4 lg:px-6">
        <Link
          href="/properties"
          className="batta-surface-navy-luxe tap-target relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl p-6 ring-1 ring-gold/25 transition active:scale-[0.99] lg:hidden"
        >
          <div className="relative min-w-0">
            <span className="batta-eyebrow">Browse the catalogue</span>
            <div
              className={`mt-2 text-[22px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              <span className="gradient-gold-text">{t("nav.properties")}</span>
            </div>
            <div className="mt-1 text-[12px] text-muted">{t("brand.slogan")}</div>
          </div>
          <span className="batta-gold-fill inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10 shadow-[var(--shadow-gold)]">
            <ArrowUpRight className="size-5" strokeWidth={2.5} />
          </span>
        </Link>

        {/* Desktop spread. Not a duplicate of the mobile band — different
            information density. Left column closes the brand pitch, right
            column gives the user three concrete next-action shortcuts so
            the page doesn't bottom-out on a single link. */}
        <div className="hidden lg:block">
          <div className="batta-surface-navy-luxe relative overflow-hidden rounded-3xl ring-1 ring-gold/25">
            <div className="relative grid grid-cols-12 gap-8 px-10 py-12">
              <div className="col-span-7">
                <span className="batta-eyebrow text-[10.5px]">
                  {t("brand.slogan")}
                </span>
                <h2 className="mt-3 text-[48px] font-extrabold leading-[1.05] tracking-tight">
                  <span className="gradient-gold-text">
                    {t("home.heroBrandTitle")}
                  </span>
                </h2>
                <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-muted">
                  {t("home.trustEscrowBody")}
                </p>
                <div className="mt-7 flex items-center gap-3">
                  <Link
                    href="/properties"
                    className="batta-gold-fill inline-flex items-center gap-2 rounded-full px-5 py-3 text-[12.5px] font-extrabold uppercase tracking-[0.14em] shadow-[var(--shadow-gold)] transition active:scale-[0.99]"
                  >
                    {t("home.heroBrowseCta")}
                    <ArrowUpRight className="size-4" strokeWidth={2.5} />
                  </Link>
                  <Link
                    href="/sell"
                    className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-3 text-[12.5px] font-bold text-foreground transition hover:border-gold-soft/60 hover:bg-gold-faint"
                  >
                    Vendre
                  </Link>
                </div>
              </div>

              {/* Right column — three quiet shortcut tiles. Each lands on
                  a different surface so the user gets a guided next step
                  no matter which intent they came in with. */}
              <div className="col-span-5 flex flex-col gap-3">
                {[
                  { num: "01", href: "/properties" as const, title: t("nav.properties"), body: t("home.step1Body") },
                  { num: "02", href: "/kyc"        as const, title: t("home.step2Title"), body: t("home.step2Body") },
                  { num: "03", href: "/sell"       as const, title: "Vendre",            body: t("home.step3Body") },
                ].map((s) => (
                  <Link
                    key={s.num}
                    href={s.href as never}
                    className="group flex items-start gap-4 rounded-2xl bg-surface/40 p-4 ring-1 ring-gold/15 backdrop-blur-sm transition hover:bg-surface/70 hover:ring-gold-soft/40"
                  >
                    <span className="batta-tabular text-[20px] font-extrabold leading-none text-gold">
                      {s.num}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-bold leading-tight text-foreground">
                        {s.title}
                      </span>
                      <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                        {s.body}
                      </span>
                    </span>
                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted transition group-hover:text-gold-bright" strokeWidth={2.2} />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Slim footer — single inline row of legal links. The big
          brand-name + slogan + gavel rule stack was nice but the user
          flagged it as text-heavy on a marketplace home. */}
      <section className="mt-10 px-4 pb-6">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
          <Link href="/terms" className="hover:text-gold-bright">
            {t("landing.footerLinks.terms")}
          </Link>
          <span className="text-subtle">·</span>
          <Link href="/privacy" className="hover:text-gold-bright">
            {t("landing.footerLinks.privacy")}
          </Link>
          <span className="text-subtle">·</span>
          <Link href="/contact" className="hover:text-gold-bright">
            {t("landing.footerLinks.contact")}
          </Link>
          <span className="text-subtle">·</span>
          <span className="text-subtle">© {new Date().getFullYear()} {t("brand.name")}</span>
        </div>
      </section>
    </div>


    <HomeDesktop
      heroSlides={heroSlides}
      trending={trending}
      offers={offers}
      nouveautes={nouveautes}
      recent={recent}
      hammered={hammered}
      savedIds={savedIds}
      loggedIn={loggedIn}
      liveCount={liveCount}
      scheduledCount={scheduledCount}
      soldThisMonthCount={soldThisMonthCount}
      coverageGovs={coverageGovs}
    />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Building blocks — ported from the mazed-auto home pattern
// ──────────────────────────────────────────────────────────────────────

/**
 * Rail header — lightweight title above a horizontal scroller or grid.
 */
function RailHeader({
  eyebrow,
  title,
  countLabel,
  ctaHref,
  ChevronEnd,
  isRTL,
  seeAllLabel,
  flush,
  noCta,
}: {
  /** Tracked uppercase metallic-gold label sitting above the title.
      Optional — only the headline section needs it; secondary rails
      can stay single-line for less visual noise. */
  eyebrow?: string;
  title: string;
  countLabel?: number;
  /** All "see all" CTAs point at /properties — the unified Explore
      surface (Reels + Grid + numbered pagination). The /auctions
      index was removed (it was a duplicate of /properties); the
      detail route /auctions/[id] still exists for individual lots. */
  ctaHref: "/properties";
  ChevronEnd: React.ComponentType<{ className?: string }>;
  isRTL: boolean;
  /** Pre-translated "See all" label. Server component callers pass
      `t("home.seeAll")`. */
  seeAllLabel: string;
  flush?: boolean;
  noCta?: boolean;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 ${flush ? "px-4" : ""}`}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="batta-gold-rule-short" />
            <span
              className={`batta-eyebrow ${isRTL ? "font-arabic tracking-[0.18em]" : ""}`}
            >
              {eyebrow}
            </span>
          </div>
        )}
        <h3
          className={`inline-flex items-center gap-2 text-[19px] font-extrabold leading-tight tracking-tight ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          {title}
          {countLabel !== undefined && (
            // Count as a soft gold chip rather than naked parens —
            // reads as "7 of these" instead of debug metadata. Sized
            // with a touch of breathing room so the number doesn't sit
            // flush against the chip border.
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gold-faint px-2.5 text-[11px] font-extrabold tracking-wider text-gold-bright">
              {countLabel}
            </span>
          )}
        </h3>
      </div>
      {!noCta && (
        // Every "See all" link goes to the unified Explore page —
        // user picks Grid vs Reels there via the toolbar toggle.
        <Link
          href={ctaHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:border-gold-soft/40 hover:text-gold"
        >
          {seeAllLabel}
          <ChevronEnd className="size-3" />
        </Link>
      )}
    </div>
  );
}

/**
 * Build the hero carousel's slide list from the top trending auctions.
 *
 * Each real slide uses the listing's first photo as the background, the
 * city as a chip on top, and the price + locale-formatted TND as the
 * headline. When `trending` is empty we fall through to brand-themed
 * fallback slides so the carousel never renders empty (fresh dev clone,
 * empty DB, etc.).
 */
function buildHeroSlides(
  trending: AuctionWithProperty[],
  locale: string,
  liveCount: number,
  labels: {
    liveWord: string;
    tnd: string;
    bidCta: string;
    browseCta: string;
    brandTitle: string;
    brandSlogan: string;
    /** "Live · {n}" — the server caller resolves the ICU placeholder. */
    brandEyebrow: string;
  },
): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const a of trending.slice(0, 5)) {
    const property = a.property;
    const photo = property.photos
      ?.sort((p, q) => p.sort_order - q.sort_order)[0];
    if (!photo) continue;
    const price = a.current_price ?? a.opening_price;
    const isLive = a.status === "live" || a.status === "extending";
    slides.push({
      id: a.id,
      imageUrl: propertyPhotoUrl(photo.storage_path),
      eyebrow: isLive
        ? `${labels.liveWord} · ${property.governorate}`
        : property.governorate,
      title: property.title,
      subtitle: `${formatTND(price, locale)} ${labels.tnd}`,
      href: `/auctions/${a.id}`,
      ctaLabel: labels.bidCta,
    });
  }

  // Brand-pitch slide closes the carousel. Marked `kind: "brand"` so
  // SlideCard renders the dedicated luxe composition (navy gradient,
  // gold concentric arcs, live-count hero stat) instead of treating
  // it as another photo overlay. `imageUrl` is null because the slide
  // paints its own CSS background.
  slides.push({
    id: "brand-pitch",
    imageUrl: null,
    eyebrow: "",
    title: labels.brandTitle,
    subtitle: labels.brandSlogan,
    href: "/properties",
    ctaLabel: labels.browseCta,
    kind: "brand",
    liveCount,
  });

  return slides;
}

/**
 * Slides for the second-tier hero — the items closest to closing after
 * the top hero's headliners. Same shape as `buildHeroSlides` but the
 * eyebrow leads with "Bientôt clos" instead of "En direct", so the
 * surface reads as urgency-on-urgency rather than a duplicate of the
 * top hero. No brand-pitch slide — this carousel is purely listings.
 */
function buildEndingSoonSlides(
  rows: AuctionWithProperty[],
  locale: string,
  labels: { endingSoonWord: string; tnd: string; bidCta: string },
): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const a of rows) {
    const property = a.property;
    const photo = property.photos
      ?.sort((p, q) => p.sort_order - q.sort_order)[0];
    if (!photo) continue;
    const price = a.current_price ?? a.opening_price;
    slides.push({
      id: a.id,
      imageUrl: propertyPhotoUrl(photo.storage_path),
      eyebrow: `${labels.endingSoonWord} · ${property.governorate}`,
      title: property.title,
      subtitle: `${formatTND(price, locale)} ${labels.tnd}`,
      href: `/auctions/${a.id}`,
      ctaLabel: labels.bidCta,
    });
  }
  return slides;
}

// ──────────────────────────────────────────────────────────────────────
// Browse-by-type / browse-by-price tables.
// ──────────────────────────────────────────────────────────────────────

const PROPERTY_TYPES: {
  key: string;
  labelEn: string;
  labelAr: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "apartment",  labelEn: "Apartment",   labelAr: "شقة",       Icon: Building2 },
  { key: "villa",      labelEn: "Villa",       labelAr: "فيلا",      Icon: Home },
  { key: "house",      labelEn: "House",       labelAr: "منزل",      Icon: Home },
  { key: "land",       labelEn: "Land",        labelAr: "أرض",       Icon: Trees },
  { key: "commercial", labelEn: "Commercial",  labelAr: "محل تجاري", Icon: Store },
  { key: "office",     labelEn: "Office",      labelAr: "مكتب",      Icon: Briefcase },
];

const PRICE_BUCKETS: {
  key: string;
  labelEn: string;
  labelAr: string;
  /** Maps to the params /properties actually reads (min_price/max_price). */
  query: string;
}[] = [
  { key: "under-100k",  labelEn: "Moins de 100k", labelAr: "أقل من 100 ألف",   query: "max_price=100000" },
  { key: "100k-500k",   labelEn: "100k – 500k",   labelAr: "100 – 500 ألف",    query: "min_price=100000&max_price=500000" },
  { key: "500k-1m",     labelEn: "500k – 1M",     labelAr: "500 ألف – 1 مليون", query: "min_price=500000&max_price=1000000" },
  { key: "1m-plus",     labelEn: "1M+ TND",       labelAr: "أكثر من مليون",     query: "min_price=1000000" },
];

// HOW_IT_WORKS + TRUST_PILLARS used to live here at the bottom of
// the file. They were hoisted above LandingPage (alongside StatTile's
// past placement) to dodge the Turbopack-RSC hoister bug — module
// `const` declarations defined AFTER the long LandingPage body
// occasionally fail to resolve at server-render time in dev.

// ──────────────────────────────────────────────────────────────────────
// "Recently hammered" — compact card for the closed-auction strip.
// (HammeredRow type is hoisted to the top of the file.)
// ──────────────────────────────────────────────────────────────────────

function HammeredCard({
  row,
  locale,
  isRTL,
  soldLabel,
  tnd,
}: {
  row: HammeredRow;
  locale: string;
  isRTL: boolean;
  soldLabel: string;
  tnd: string;
}) {
  const photo = row.property.photos
    ?.slice()
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  const price = Number(row.winner_amount ?? 0);
  return (
    <Link
      href={`/auctions/${row.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl bg-surface-2 transition active:scale-[0.98] hover:bg-surface"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
        {photo ? (
          (() => {
            const src = propertyPhotoUrl(photo.storage_path);
            return (
              <Image
                src={src}
                alt=""
                fill
                sizes="(min-width: 1024px) 220px, 200px"
                unoptimized={isStaticSeedPath(src)}
                className="object-cover transition duration-500 group-hover:scale-105"
              />
            );
          })()
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-foreground/15">🏛️</div>
        )}
        <span className="batta-gold-fill absolute top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ltr:left-2 rtl:right-2">
          <Gavel className="size-2.5" strokeWidth={2.5} />
          {soldLabel}
        </span>
      </div>
      <div className="p-3">
        <div className="batta-tabular gradient-gold-text text-[18px] font-extrabold leading-none">
          {formatTND(price, locale)}
          <span className="ms-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
            {tnd}
          </span>
        </div>
        <div className={`mt-1.5 line-clamp-1 text-[12px] font-bold text-foreground ${isRTL ? "font-arabic" : ""}`}>
          {row.property.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
          <MapPin className="size-2.5" strokeWidth={2} />
          <span className="truncate">{row.property.governorate}</span>
        </div>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="block">
      <div className="aspect-[4/5] rounded-2xl bg-surface-2" />
      <div className="space-y-2 px-1 pt-3">
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div className="w-[230px] shrink-0 snap-start">
      <CardSkeleton />
    </div>
  );
}

// StatTile lives near the top of the file as a const expression so
// Turbopack-RSC's bundle hoister can see it before LandingPage. Same
// quirk that bit the HammeredRow type alias (see the comment at the
// top of the file).
