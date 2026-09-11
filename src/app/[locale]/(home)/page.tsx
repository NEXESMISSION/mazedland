import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { TrendingRail } from "@/components/landing/TrendingRail";
import { HeroBanner, type HeroSlide } from "@/components/landing/HeroBanner";
import { HomeDesktop } from "@/components/landing/HomeDesktop";
import { LG_UP } from "@/components/ui/HiddenAt";
import { AnnonceCard } from "@/components/listing/AnnonceCard";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import { getHomeFeed, type HomeListingRow } from "@/lib/home/feed";
import { log } from "@/lib/log";
import { PerfProbe } from "@/components/dev/PerfProbe";
import { catalogueHrefForType } from "@/lib/catalog/browse";

// Statically render + ISR-revalidate every 60s. The home page is the same
// for everyone (public catalogue); per-user bits (saved hearts, login state)
// are filled in client-side via the watchlist store after hydration. This
// lets Vercel serve the page straight from the edge CDN — ~20ms TTFB and no
// serverless cold start — instead of rendering ~200 cards on every request.
export const revalidate = 60;
import {
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Building2,
  Home,
  Trees,
  Store,
  Briefcase,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ClipboardCheck,
  Scale,
  Lock,
  Sparkles,
} from "lucide-react";

// Home data layer (getHomeFeed + selects + feed types) lives in
// "@/lib/home/feed" so this route file stays render-focused.

/**
 * Race a promise against a deadline. The home page fans out several
 * round-trips to a remote Supabase; if one of them hangs (pooler hiccup,
 * network blip) the whole server render would stall and the route's
 * loading.tsx Suspense fallback would spin forever — the "stuck loading"
 * users hit intermittently. A timeout turns a hang into a fast fallback:
 * the page renders its brand hero + browse rails instead of freezing.
 */
/**
 * How long the data phase may take. Short in development, where a person is
 * watching the spinner; long in production, where the render is a background
 * ISR regeneration and a slow-but-successful query is worth waiting for.
 */
const HOME_DATA_BUDGET_MS = process.env.NODE_ENV === "production" ? 8000 : 2500;

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
    href: "/annonces", Icon: Search,
  },
  {
    key: "verify", eyebrowKey: "home.step2Eyebrow",
    titleKey: "home.step2Title", bodyKey: "home.step2Body",
    href: "/annonces", Icon: Phone,
  },
  {
    key: "bid", eyebrowKey: "home.step3Eyebrow",
    titleKey: "home.step3Title", bodyKey: "home.step3Body",
    href: "/annonces/nouvelle", Icon: Plus,
  },
];

// Trust pillars — what protects the user.
//
// These were the four AUCTION guarantees: escrow, the KYC gate, the inspection
// workflow, and Tunisian-law surenchère delays. Not one of them describes what
// a classifieds site promises, and three no longer exist as code. They are now
// the four things Mazed Immo actually does: it checks every annonce before it goes
// up, it never publishes a phone number, it verifies sellers who ask to be,
// and it takes no cut of the sale.
const TRUST_PILLARS: {
  key: string;
  titleKey: string;
  bodyKey: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "checked",  titleKey: "home.trustEscrowTitle",     bodyKey: "home.trustEscrowBody",     Icon: ClipboardCheck },
  { key: "privacy",  titleKey: "home.trustKycTitle",        bodyKey: "home.trustKycBody",        Icon: Lock },
  { key: "verified", titleKey: "home.trustInspectionTitle", bodyKey: "home.trustInspectionBody", Icon: ShieldCheck },
  { key: "nofee",    titleKey: "home.trustLegalTitle",      bodyKey: "home.trustLegalBody",      Icon: Scale },
];

// `Sparkles` is imported for a planned featured-tag pass and isn't
// referenced yet; touch it here so the strict-import lint stays happy.
const _sparklesKeepAlive = Sparkles;
void _sparklesKeepAlive;


export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Required for static rendering with next-intl — must run before any
  // getTranslations/getLocale call, or next-intl falls back to dynamic.
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const isRTL = locale === "ar";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;
  // Both device trees are rendered and CSS picks one (lg breakpoint). The
  // page is static, so saved-hearts + login state stay false here and the
  // client watchlist store fills them in after hydration.

  // One round-trip for the listing surfaces. The smaller widgets
  // (LiveTicker, RecentBidsFeed, CoverageStrip, EndingSoonBanner) each
  // own their own queries — cheap, parallelizable, fail-soft.
  let trending: HomeListingRow[] = [];
  let recent: HomeListingRow[] = [];
  // "Bonnes affaires" rail — the cheapest published annonces per square
  // metre. This slot used to hold "Offres directes", which separated
  // fixed-price lots from bidding lots; every annonce is fixed-price now, so
  // that split says nothing. Price per m² is what a property buyer actually
  // scans a home page for, and no other surface answers it.
  let bestValue: HomeListingRow[] = [];
  // "Nouveautés" rail — newest by created_at, distinct from trending which
  // leads with the most recently published. Same horizontal scroller, a
  // different question: "what is new" rather than "what is worth seeing".
  let nouveautes: HomeListingRow[] = [];
  // Always empty / false at static render time — the client favourites store
  // fills in the real saved set + login state post-hydration.
  const savedIds = new Set<string>();
  const loggedIn = false;
  // Hero + stat-strip figures. `liveCount` is now the number of annonces
  // ONLINE, not lots mid-auction; the name is kept because every consumer
  // down the tree reads it, and renaming it would be a diff about nothing.
  let liveCount = 0;
  let newThisWeek = 0;
  let coverageGovs = 0;

  // Perf instrumentation — logs to the server terminal under scope `home`.
  // `endData` measures the whole blocking data phase (everything that gates
  // first paint). Individual round-trips are timed below so we can see which
  // one dominates and whether getHomeFeed was a cache hit (~0ms) or a miss.
  const perf = log.scope("home");
  const endData = perf.time("data-phase total");
  try {
    await withTimeout((async () => {
    // Bucketed to the day so the cache key is stable within a day — the
    // "new this week" figure only needs day granularity.
    const weekStart = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 7);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    // SHARED public data — cookieless service-role client, cached 60s. No
    // per-user work happens here: the page is statically rendered, so saved
    // hearts + login state are filled client-side after hydration. That is
    // what lets this whole page be CDN-cached instead of rendered per request.
    const endFeed = perf.time("getHomeFeed (hit≈0ms, miss=4 queries)");
    const feed = await getHomeFeed(weekStart);
    endFeed();

    const rows = feed?.published.rows ?? [];
    // eslint-disable-next-line react-hooks/immutability -- synchronising with an external system, which is what an effect is for.
    liveCount = feed?.published.count ?? rows.length;
    newThisWeek = feed?.newThisWeek ?? 0;
    bestValue = feed?.bestValue ?? [];
    nouveautes = feed?.nouveautes ?? [];
    coverageGovs = new Set(feed?.govs ?? []).size;

    // Two surfaces over one slice:
    //   - the trending rail (horizontal scroller, self-sized to the dataset)
    //   - the "plus à explorer" grid underneath
    //
    // Below ~16 rows they deliberately OVERLAP, so neither renders empty. A
    // catalogue with 12 published annonces used to leave the grid showing one
    // lonely card; now the rail covers the front and the grid shows the back
    // half of the same set.
    trending = rows.slice(0, 18);
    recent = rows.length >= 16 ? rows.slice(12) : rows.slice(Math.min(rows.length, 8));

    perf.debug("data ready", {
      published: rows.length,
      trending: trending.length,
      nouv: nouveautes.length,
      bestValue: bestValue.length,
    });
    })(), HOME_DATA_BUDGET_MS);
  } catch (err) {
    perf.warn("data-phase aborted (timeout or error)", err);
    // In production this render is an ISR REGENERATION, and nobody is waiting
    // on it: visitors are being served the previous page while it runs. The
    // fallback below would still render — an empty catalogue, "0 biens" — and
    // Next would then cache THAT for the next 60 seconds, for everyone. One
    // slow Supabase moment was enough to blank the home page site-wide.
    //
    // Throwing instead makes Next keep serving the last good page and retry on
    // the next request. Development keeps the fallback (every request renders
    // there, so a hang is a real wait), and so does `next build`, where a
    // throw would fail a deploy over a transient database hiccup.
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      throw err;
    }
  } finally {
    endData();
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

  // Second "ending soon" hero carousel — built once, shown on mobile AND
  // (now) desktop. Empty when there aren't enough trending lots to fill it.
  const endingSoonSlides =
    trending.length > 5
      ? buildEndingSoonSlides(trending.slice(5, 10), locale, {
          endingSoonWord: t("home.endingSoonEyebrow"),
          tnd: t("common.tnd"),
          bidCta: t("home.heroBidCta"),
        })
      : [];

  return (
    <>
    {/* Client-side perf probe — logs nav/paint/LCP/long-task/resource
        timings to the browser console (scope `perf`). Dev-only unless
        NEXT_PUBLIC_PERF_PROBE=1. Renders nothing. */}
    <PerfProbe tag="home" />
    {/* ════════════════════════════════════════════════════════════════
        MOBILE / TABLET TREE (< lg) — CSS-gated with `lg:hidden`; the
        desktop tree below is `hidden lg:block`. Both are rendered so the
        page stays static (no server-side device detection); CSS picks one.
        ════════════════════════════════════════════════════════════════ */}
    <div className="lg:hidden mx-auto max-w-[var(--max-w)]">
      {/* The page's visible <h1> lives in the desktop hero, and at this width
          that whole tree is display:none — out of the accessibility tree too.
          The phone layout opens on a photo carousel, so its heading is for
          screen readers and search engines. */}
      <h1 className="sr-only">{t("home.heroBrandTitle")}</h1>
      {/* ───── HERO BANNER ─────
          Auto-advancing image carousel sourced from the top trending
          auctions. Each slide is a full-bleed property photo with the
          listing's headline + price overlaid; tap goes straight to the
          auction. Fallback brand slides kick in when the DB has nothing
          live so the carousel never renders empty. */}
      <HeroBanner slides={heroSlides} isRTL={isRTL} priority hiddenAt={LG_UP} />


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
          ctaHref="/annonces"
          ChevronEnd={ChevronEnd}
          isRTL={isRTL}
          seeAllLabel={t("home.seeAll")}
          flush
        />
        {/* Horizontal snap rail, auto-advancing.
            These rails used to be followed by a `hidden lg:grid` of eight more
            cards "for desktop" — inside this tree, which is itself lg:hidden,
            so no screen ever showed them. Home shipped 24 invisible cards, and
            their photos were preloaded. The desktop layout is HomeDesktop. */}
        {trending.length > 0 ? (
          <TrendingRail>
            {trending.map((a) => (
              <div key={a.id} className="w-[230px] shrink-0 snap-start">
                <AnnonceCard
                  listing={a}
                  saved={savedIds.has(a.id)}
                  loggedIn={loggedIn}
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

      {/* ─── "Bonnes affaires" rail — the cheapest published annonces per
          square metre.

          This slot held "Offres directes": fixed-price stock, kept apart from
          the bidding lots. Every annonce is fixed-price now, so that split
          distinguished nothing. Price per m² is the comparison a property
          buyer is actually making, and no other surface on the site answers
          it. Listings with no surface are excluded rather than sorted to the
          bottom with an invented number — see `pricePerSqm` in the feed. */}
      {bestValue.length > 0 && (
        <section className="mt-7">
          <RailHeader
            eyebrow="Le meilleur rapport"
            title="Bonnes affaires"
            countLabel={bestValue.length}
            ctaHref="/annonces"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
            flush
          />
          <TrendingRail>
            {bestValue.map((a) => (
              <div key={a.id} className="w-[230px] shrink-0 snap-start">
                <AnnonceCard
                  listing={a}
                  saved={savedIds.has(a.id)}
                  loggedIn={loggedIn}
                />
              </div>
            ))}
            <div className="w-1 shrink-0" />
          </TrendingRail>
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
            ctaHref="/annonces"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
            flush
          />
          <TrendingRail>
            {nouveautes.map((a) => (
              <div key={a.id} className="w-[230px] shrink-0 snap-start">
                <AnnonceCard
                  listing={a}
                  saved={savedIds.has(a.id)}
                  loggedIn={loggedIn}
                />
              </div>
            ))}
            <div className="w-1 shrink-0" />
          </TrendingRail>
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
      {endingSoonSlides.length > 0 && (
        <div className="mt-6 lg:hidden">
          <HeroBanner slides={endingSoonSlides} isRTL={isRTL} />
        </div>
      )}



      {/* More auctions — second batch on a 2-up grid. Replaces the
          old "Featured estates" + "Recently added" duplicate sections
          (those rendered the same rows.slice as the trending rail).
          One header, one grid, the rest of the available data. */}
      {recent.length > 0 && (
        <section className="mt-9 px-4">
          <RailHeader
            title={t("home.moreToExplore")}
            ctaHref="/annonces"
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
            flush
          />
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {recent.map((a) => (
              <AnnonceCard
                key={a.id}
                listing={a}
                saved={savedIds.has(a.id)}
                loggedIn={loggedIn}
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
              href={catalogueHrefForType(pt.key) as `/annonces`}
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
              href={`/annonces?${b.query}` as `/annonces`}
              className="tap-target inline-flex shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-full bg-surface-2 px-4 py-2.5 text-[12px] font-bold leading-none text-foreground transition active:scale-[0.97] hover:bg-surface"
            >
              {isRTL ? b.labelAr : b.labelEn}
            </Link>
          ))}
        </div>
      </section>

      {/* The "Récemment adjugés" rail stood here — real hammer prices, as
          social proof. There is no honest equivalent for a classifieds site:
          we publish what a seller ASKS, and what a property finally sold for
          is between the buyer, the seller and their notary. A "sold" rail
          built from asking prices would be a claim we cannot support, so the
          section is gone rather than reworded. */}

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
          <span className="mazed-eyebrow">{t("home.howItWorksEyebrow")}</span>
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
              className="mazed-frame group flex w-[260px] shrink-0 snap-start flex-col gap-3 rounded-2xl p-5 transition active:scale-[0.99] hover:ring-gold-soft/50 lg:w-auto"
            >
              <div className="flex items-center gap-3">
                <span className="mazed-monogram mazed-monogram-filled size-10 text-[15px]">
                  <step.Icon className="size-4" strokeWidth={2.2} />
                </span>
                <span className="mazed-tabular text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold">
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
          <span className="mazed-eyebrow">{t("home.trustEyebrow")}</span>
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
              className="mazed-surface-navy-luxe relative flex w-[230px] shrink-0 snap-start flex-col gap-2.5 overflow-hidden rounded-2xl p-5 ring-1 ring-gold/25 lg:w-auto"
            >
              <span className="mazed-monogram size-10 shrink-0 text-gold">
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

      {/* Final browse band — one line, with a finger-sized chevron. */}
      <section className="mt-10 px-4 lg:px-6">
        <Link
          href="/annonces"
          className="mazed-surface-navy-luxe tap-target relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl p-6 ring-1 ring-gold/25 transition active:scale-[0.99] lg:hidden"
        >
          <div className="relative min-w-0">
            <span className="mazed-eyebrow">Parcourir le catalogue</span>
            <div
              className={`mt-2 text-[22px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              <span className="gradient-gold-text">{t("nav.properties")}</span>
            </div>
            <div className="mt-1 text-[12px] text-muted">{t("brand.slogan")}</div>
          </div>
          <span className="mazed-gold-fill inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10 shadow-[var(--shadow-gold)]">
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

    <HomeDesktop
      endingSoonSlides={endingSoonSlides}
      trending={trending}
      bestValue={bestValue}
      nouveautes={nouveautes}
      recent={recent}
      savedIds={savedIds}
      loggedIn={loggedIn}
      liveCount={liveCount}
      newThisWeek={newThisWeek}
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
  ctaHref: "/annonces";
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
            <span className="mazed-gold-rule-short" />
            <span
              className={`mazed-eyebrow ${isRTL ? "font-arabic tracking-[0.18em]" : ""}`}
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
 * Build the hero carousel's slide list from the top annonces.
 *
 * Each real slide uses the listing's first photo as the background, the place
 * as a chip on top, and the price as the headline. When the catalogue is empty
 * we fall through to a brand slide so the carousel never renders blank on a
 * fresh clone.
 *
 * The eyebrow used to read "En direct · Sfax" and the CTA "Enchérir". Neither
 * is true of a fixed price, so the eyebrow carries the place and the surface
 * instead — which is what a buyer scanning a hero is reading for.
 */
function buildHeroSlides(
  trending: HomeListingRow[],
  locale: string,
  liveCount: number,
  labels: {
    liveWord: string;
    tnd: string;
    bidCta: string;
    browseCta: string;
    brandTitle: string;
    brandSlogan: string;
    /** The eyebrow on the brand slide — the caller resolves the placeholder. */
    brandEyebrow: string;
  },
): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const l of trending.slice(0, 5)) {
    const photo = (l.photos ?? []).slice().sort((p, q) => p.sort_order - q.sort_order)[0];
    if (!photo) continue;
    const area = Number((l.attributes ?? {}).area_sqm);
    const where = l.delegation?.trim() || l.governorate;
    slides.push({
      id: l.id,
      imageUrl: propertyPhotoUrl(photo.storage_path),
      eyebrow: Number.isFinite(area) && area > 0 ? `${where} · ${area} m²` : where,
      title: l.title,
      subtitle:
        l.price_on_request || l.price == null
          ? "Prix sur demande"
          : `${formatTND(Number(l.price), locale)} ${labels.tnd}`,
      href: `/annonces/${l.id}`,
      ctaLabel: labels.bidCta,
    });
  }

  // Brand-pitch slide closes the carousel. `kind: "brand"` makes SlideCard
  // render the navy/gold composition instead of treating it as a photo
  // overlay, so `imageUrl` is null — it paints its own background.
  slides.push({
    id: "brand-pitch",
    imageUrl: null,
    eyebrow: "",
    title: labels.brandTitle,
    subtitle: labels.brandSlogan,
    href: "/annonces",
    ctaLabel: labels.browseCta,
    kind: "brand",
    liveCount,
  });

  return slides;
}

/**
 * Slides for the second-tier hero. Same shape as `buildHeroSlides`, a
 * different lead: it opens on the newest arrivals rather than repeating the
 * headliners. No brand slide — this carousel is purely annonces.
 */
function buildEndingSoonSlides(
  rows: HomeListingRow[],
  locale: string,
  labels: { endingSoonWord: string; tnd: string; bidCta: string },
): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const l of rows) {
    const photo = (l.photos ?? []).slice().sort((p, q) => p.sort_order - q.sort_order)[0];
    if (!photo) continue;
    slides.push({
      id: l.id,
      imageUrl: propertyPhotoUrl(photo.storage_path),
      eyebrow: `${labels.endingSoonWord} · ${l.delegation?.trim() || l.governorate}`,
      title: l.title,
      subtitle:
        l.price_on_request || l.price == null
          ? "Prix sur demande"
          : `${formatTND(Number(l.price), locale)} ${labels.tnd}`,
      href: `/annonces/${l.id}`,
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
  /** The price params the catalogue reads (`min` / `max`, in TND). */
  query: string;
}[] = [
  { key: "under-100k",  labelEn: "Moins de 100k", labelAr: "أقل من 100 ألف",   query: "max=100000" },
  { key: "100k-500k",   labelEn: "100k – 500k",   labelAr: "100 – 500 ألف",    query: "min=100000&max=500000" },
  { key: "500k-1m",     labelEn: "500k – 1M",     labelAr: "500 ألف – 1 مليون", query: "min=500000&max=1000000" },
  { key: "1m-plus",     labelEn: "1M+ TND",       labelAr: "أكثر من مليون",     query: "min=1000000" },
];

// StatTile lives near the top of the file as a const expression so
// Turbopack-RSC's bundle hoister can see it before LandingPage. Same
// quirk that bit the HammeredRow type alias (see the comment at the
// top of the file).

/**
 * Rail placeholders. These were collateral: they sat just past the ticker's
 * fallback, and removing that took them too. `TrendingSkeleton` is still what
 * the trending rail renders while the catalogue query is in flight.
 */
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
