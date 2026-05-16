import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LiveTicker } from "@/components/landing/LiveTicker";
import { TrendingRail } from "@/components/landing/TrendingRail";
import { RecentBidsFeed } from "@/components/landing/RecentBidsFeed";
import { CoverageStrip } from "@/components/landing/CoverageStrip";
import { EndingSoonBanner } from "@/components/landing/EndingSoonBanner";
import { HeroBanner, type HeroSlide } from "@/components/landing/HeroBanner";
import { HomeSearch } from "@/components/landing/HomeSearch";
import { PropertyCard } from "@/components/property/PropertyCard";
import { propertyPhotoUrl } from "@/lib/imageUrl";
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
 * Landing page — black + gold dark mode, design language ported from
 * the mazed-auto home feed. Every section is grouped under a
 * `SectionDivider` (gradient hairline → icon chip → eyebrow → bold
 * Jakarta title) so the page reads as a structured feed instead of a
 * loose stack of cards.
 */
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
  let hammered: HammeredRow[] = [];
  let savedIds = new Set<string>();
  let loggedIn = false;
  let liveCount = 0;

  try {
    const supabase = await getServerSupabase();
    const [liveRes, hammeredRes, userRes] = await Promise.all([
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
        .limit(18),
      // "Recently hammered" — sold auctions for social-proof. Shows
      // the actual price real properties cleared at; only data the
      // platform has that newspaper auctions don't. Pulls 8 so the
      // section can fill a 2-col grid even when half the rows are
      // missing photos.
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
        .limit(8),
      supabase.auth.getUser(),
    ]);

    const rows = (liveRes.data ?? []) as unknown as AuctionWithProperty[];
    liveCount = liveRes.count ?? rows.length;

    // Surfaces:
    //   - trending rail (first 8, horizontal scroller)
    //   - "More to explore" grid (rest of the dataset, 2-up)
    //
    // When there are fewer than ~12 listings we deliberately let the
    // rail and the grid OVERLAP so neither section renders empty.
    // A dev DB with 9 rows used to leave the grid showing 1 lonely
    // card; now it shows all 9 even though the rail covers the first 8.
    trending = rows.slice(0, 8);
    recent = rows.length >= 12 ? rows.slice(8) : rows;
    hammered = (hammeredRes.data ?? []) as unknown as HammeredRow[];

    loggedIn = !!userRes.data.user;
    if (loggedIn && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const { data: saves } = await supabase
        .from("watchlist")
        .select("auction_id")
        .eq("user_id", userRes.data.user!.id)
        .in("auction_id", ids);
      savedIds = new Set((saves ?? []).map((s) => s.auction_id as string));
    }
  } catch {
    // env missing → skeletons / placeholder content takes over below.
  }

  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* ───── HERO BANNER ─────
          Auto-advancing image carousel sourced from the top trending
          auctions. Each slide is a full-bleed property photo with the
          listing's headline + price overlaid; tap goes straight to the
          auction. Fallback brand slides kick in when the DB has nothing
          live so the carousel never renders empty. */}
      <HeroBanner
        slides={buildHeroSlides(trending, locale, isRTL, liveCount)}
        isRTL={isRTL}
      />

      {/* Search bar — the marketplace's primary action, missing until
          now. Posts to /auctions?view=classic so intent-driven users
          jump straight into a filtered catalogue. */}
      <div className="mt-4">
        <HomeSearch isRTL={isRTL} />
      </div>

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
          eyebrow={isRTL ? "مباشر الآن" : "Live now"}
          title={isRTL ? "الأكثر متابعة" : "Trending now"}
          countLabel={trending.length}
          ctaHref="/auctions"
          ChevronEnd={ChevronEnd}
          isRTL={isRTL}
        />
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
      </section>

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
            title={isRTL ? "اكتشف المزيد" : "More to explore"}
            ctaHref="/auctions"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
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
      <section className="mt-10 px-4">
        <h3 className={`text-[15px] font-bold leading-tight ${isRTL ? "font-arabic" : ""}`}>
          {isRTL ? "تصفح حسب النوع" : "Browse by type"}
        </h3>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {PROPERTY_TYPES.map((pt) => (
            <Link
              key={pt.key}
              href={`/properties?type=${pt.key}` as `/properties`}
              className="tap-target inline-flex shrink-0 snap-start items-center gap-2 rounded-full bg-surface-2 px-4 py-2.5 transition active:scale-[0.97] hover:bg-surface"
            >
              <pt.Icon className="size-4 text-gold" strokeWidth={2} />
              <span
                className={`whitespace-nowrap text-[12px] font-bold leading-none text-foreground ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {isRTL ? pt.labelAr : pt.labelEn}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Browse by price — 4 buckets on a single scroll rail. Soft-fill
          pills, no border, no trailing arrow (it added clutter without
          function — tap the pill itself). */}
      <section className="mt-7 px-4">
        <h3 className={`text-[15px] font-bold leading-tight ${isRTL ? "font-arabic" : ""}`}>
          {isRTL ? "تصفح حسب السعر" : "Browse by price"}
        </h3>
        <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {PRICE_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/properties?price=${b.key}` as `/properties`}
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
              {isRTL ? "بيعت مؤخراً" : "Recently hammered"}
            </h3>
            <span className="text-[11px] text-muted">{isRTL ? "أسعار حقيقية" : "real prices"}</span>
          </div>
          <div className="snap-rail hide-scrollbar mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
            {hammered.map((h) => (
              <div key={h.id} className="w-[200px] shrink-0 snap-start">
                <HammeredCard row={h} locale={locale} isRTL={isRTL} />
              </div>
            ))}
            <div className="w-1 shrink-0" />
          </div>
        </section>
      )}

      {/* Final browse band */}
      <section className="mt-10 px-4">
        <Link
          href="/properties"
          className="batta-surface-navy-luxe tap-target relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl p-6 ring-1 ring-gold/25 transition active:scale-[0.99]"
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
  flush,
  noCta,
}: {
  /** Tracked uppercase metallic-gold label sitting above the title.
      Optional — only the headline section needs it; secondary rails
      can stay single-line for less visual noise. */
  eyebrow?: string;
  title: string;
  countLabel?: number;
  /** Accepts either the legacy /properties target or the new classic
      view at /auctions?view=classic. The typed-Link constraint widens
      to the union so the locale-aware Link can resolve both. */
  ctaHref: "/properties" | "/auctions";
  ChevronEnd: React.ComponentType<{ className?: string }>;
  isRTL: boolean;
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
        // "/auctions" is the classic-view listing surface; the home's
        // See-all links point here so they share a visual language
        // (white cards on a quiet background) with the search target.
        <Link
          href={
            ctaHref === "/auctions"
              ? { pathname: "/auctions", query: { view: "classic" } }
              : ctaHref
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:border-gold-soft/40 hover:text-gold"
        >
          {isRTL ? "الكل" : "See all"}
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
  isRTL: boolean,
  liveCount: number,
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
        ? `${isRTL ? "مباشر" : "Live"} · ${property.governorate}`
        : property.governorate,
      title: property.title,
      subtitle: `${formatTND(price, locale)} ${isRTL ? "د.ت" : "TND"}`,
      href: `/auctions/${a.id}`,
      ctaLabel: isRTL ? "زايد" : "Bid",
    });
  }

  // Always finish with a brand slide so the carousel pitches Batta
  // itself before looping back to the first listing. Uses the BATTA
  // logo asset on its black background — on-brand, no external
  // dependency, no random-image surprises. Swap to a curated Tunis /
  // Sidi Bou Said skyline once we have one.
  slides.push({
    id: "brand-pitch",
    imageUrl: "/logo.png",
    eyebrow: isRTL ? `مباشر · ${liveCount} مزاد` : `Live · ${liveCount} auctions`,
    title: isRTL
      ? "بِع واشترِ بشفافية المزاد"
      : "Tunisia's real-estate auction house",
    subtitle: isRTL
      ? "شفافية. سرعة. ثقة."
      : "Transparency. Speed. Trust.",
    href: "/properties",
    ctaLabel: isRTL ? "تصفح" : "Browse",
  });

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
}[] = [
  { key: "under-100k",  labelEn: "Under 100k TND", labelAr: "أقل من 100 ألف" },
  { key: "100k-500k",   labelEn: "100k – 500k",    labelAr: "100 – 500 ألف" },
  { key: "500k-1m",     labelEn: "500k – 1M",      labelAr: "500 ألف – 1 مليون" },
  { key: "1m-plus",     labelEn: "1M+ TND",        labelAr: "أكثر من مليون" },
];

// ──────────────────────────────────────────────────────────────────────
// "Recently hammered" — compact card for the closed-auction strip.
// (HammeredRow type is hoisted to the top of the file.)
// ──────────────────────────────────────────────────────────────────────

function HammeredCard({
  row,
  locale,
  isRTL,
}: {
  row: HammeredRow;
  locale: string;
  isRTL: boolean;
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
          <Image
            src={propertyPhotoUrl(photo.storage_path)}
            alt=""
            fill
            sizes="(min-width: 1024px) 220px, 200px"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-foreground/15">🏛️</div>
        )}
        <span className="batta-gold-fill absolute top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ltr:left-2 rtl:right-2">
          <Gavel className="size-2.5" strokeWidth={2.5} />
          {isRTL ? "بيع" : "Sold"}
        </span>
      </div>
      <div className="p-3">
        <div className="batta-tabular gradient-gold-text text-[18px] font-extrabold leading-none">
          {formatTND(price, locale)}
          <span className="ms-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
            {isRTL ? "د.ت" : "TND"}
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
