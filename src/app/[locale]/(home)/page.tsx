import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdSlot } from "@/components/ads/AdSlot";
import { Link } from "@/i18n/navigation";
import { HeroBanner, type HeroSlide } from "@/components/landing/HeroBanner";
import { HomeDesktop } from "@/components/landing/HomeDesktop";
import { HomeRailSection, RailHeading } from "@/components/landing/HomeRail";
import { HomeSearch } from "@/components/landing/HomeSearch";
import { IntentChooser } from "@/components/landing/IntentChooser";
import { LG_UP } from "@/components/ui/HiddenAt";
import { AnnonceCard } from "@/components/listing/AnnonceCard";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatNumber, formatTND } from "@/lib/utils";
import { isRtl } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { shownDelegation } from "@/lib/delegations";
import { getHomeFeed, type HomeListingRow } from "@/lib/home/feed";
import { homeRailOptions, planHomeRails, splitAtMiddle, type HomeRail } from "@/lib/home/rails";
import { getSettings } from "@/lib/settings/server";
import { log } from "@/lib/log";
import { PerfProbe } from "@/components/dev/PerfProbe";
import { catalogueHrefForType } from "@/lib/catalog/browse";

// Statically render + ISR-revalidate every 60s. The home page is the same
// for everyone (public catalogue); per-user bits (saved hearts, login state)
// are filled in client-side via the watchlist store after hydration. This
// lets Vercel serve the page straight from the edge CDN — ~20ms TTFB and no
// serverless cold start — instead of rendering ~200 cards on every request.
// The rails move in the browser (AutoRail), so they change none of this.
export const revalidate = 60;

import {
  ArrowUpRight,
  Building2,
  Home,
  Trees,
  Warehouse,
  Wheat,
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
  const isRTL = isRtl(locale);
  // Both device trees are rendered and CSS picks one (lg breakpoint). The
  // page is static, so saved-hearts + login state stay false here and the
  // client watchlist store fills them in after hydration.

  // One round-trip for the listing surfaces. The smaller widgets
  // (LiveTicker, RecentBidsFeed, CoverageStrip, EndingSoonBanner) each
  // own their own queries — cheap, parallelizable, fail-soft.
  //
  // `trending` is the published slice in its paid-then-viewed order. It no
  // longer has a rail of its own — « À la une » and « Les plus vus » split
  // what « Les biens du moment » mixed — but the hero carousels still open on it.
  let trending: HomeListingRow[] = [];
  // Every rail of annonces, in page order, already cut to what each one
  // shows: « À la une », « Les plus vus », « Nouveautés », « À louer »,
  // « Bonnes affaires », one per type. See src/lib/home/rails.ts for why a
  // rail is there, and when it is not.
  let rails: HomeRail[] = [];
  // « À découvrir »: what no rail shows. (Cast, not annotated: it is set
  // inside the closure below, which TypeScript's narrowing does not follow.)
  let explore = null as HomeRail | null;
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
    //
    // Which rails, and how many cards each, are the console's (tab « Accueil »).
    // The layout has already read the settings for this render, so this is
    // React's cache, not another round trip.
    const railOptions = homeRailOptions(await getSettings());
    const endFeed = perf.time("getHomeFeed (hit≈0ms, miss=one round of parallel queries)");
    const feed = await getHomeFeed(weekStart, railOptions);
    endFeed();

    const rows = feed?.published.rows ?? [];
    // eslint-disable-next-line react-hooks/immutability -- synchronising with an external system, which is what an effect is for.
    liveCount = feed?.published.count ?? rows.length;
    newThisWeek = feed?.newThisWeek ?? 0;
    coverageGovs = new Set(feed?.govs ?? []).size;
    // The two hero carousels take five each.
    trending = rows.slice(0, 10);

    // Every rail draws from one inventory, and at a few dozen annonces that made
    // the home page the same cards over and over. The plan has each discovery
    // rail leave out what an earlier one shows, drops any rail left with fewer
    // than three cards, and lets the rails that cut by a criterion (rentals,
    // price per m², one type) keep theirs.
    // The clock is read when the page is built, about once a minute: a
    // placement that has just ended leaves « À la une » on the next build.
    ({ rails, explore } = planHomeRails(feed, railOptions));

    perf.debug("data ready", {
      published: rows.length,
      rails: rails.map((r) => `${r.key}:${r.rows.length}`).join(" "),
      explore: explore?.rows.length ?? 0,
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
    tndPerMonth: t("listing.tndPerMonth"),
    bidCta: t("home.heroBidCta"),
    browseCta: t("home.heroBrowseCta"),
    brandTitle: t("home.heroBrandTitle"),
    brandSlogan: t("brand.slogan"),
    brandEyebrow: t("home.heroBrandEyebrow", { count: liveCount }),
    priceOnRequest: t("home.priceOnRequest"),
    placeWithArea: (place, area) => t("home.slideEyebrowArea", { place, area }),
  });

  // Second "ending soon" hero carousel — built once, shown on mobile AND
  // (now) desktop. Empty when there aren't enough trending lots to fill it.
  const endingSoonSlides =
    trending.length > 5
      ? buildEndingSoonSlides(trending.slice(5, 10), locale, {
          endingSoonWord: t("home.endingSoonEyebrow"),
          tnd: t("common.tnd"),
          tndPerMonth: t("listing.tndPerMonth"),
          bidCta: t("home.heroBidCta"),
          priceOnRequest: t("home.priceOnRequest"),
        })
      : [];

  // The middle advertising space goes between these two halves, in both layouts.
  const [railsAbove, railsBelow] = splitAtMiddle(rails);

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

      {/* Sell, buy or rent — the three reasons to be here, first thing under
          the carousel. The search and every rail stay below it. */}
      <div className="mt-4 px-4">
        <IntentChooser />
      </div>

      {/* Search. The desktop header has a search box and the desktop hero has
          this component; the phone layout had neither, so a visitor could
          browse the catalogue but never search it. */}
      <div className="mt-4 px-4">
        <HomeSearch isRTL={isRTL} />
      </div>

      {/* An advertiser's banner (/admin/publicites): under the search, above
          the first rail. Nothing when no campaign runs here. */}
      <AdSlot placement="home_top" className="mt-5 px-4" sizes="100vw" />

      {/* ══════════════════════════════════════════════════════════════
          BROWSE — the page's center of gravity: the rails of annonces,
          each moving by itself (AutoRail), each with its « Tout voir ».
          Which rails, in which order, and when one is left out is
          `planHomeRails` — the desktop tree renders the same list.

          These rails used to be followed by a `hidden lg:grid` of eight more
          cards "for desktop" — inside this tree, which is itself lg:hidden,
          so no screen ever showed them. Home shipped 24 invisible cards, and
          their photos were preloaded. The desktop layout is HomeDesktop.
          ══════════════════════════════════════════════════════════════ */}
      {railsAbove.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} layout="phone" savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* A second banner, halfway down the rails. */}
      <AdSlot placement="home_middle" className="mt-6 px-4" sizes="100vw" />

      {railsBelow.map((rail) => (
        <HomeRailSection key={rail.key} rail={rail} layout="phone" savedIds={savedIds} loggedIn={loggedIn} />
      ))}

      {/* No rail at all — an empty catalogue, or the data phase timed out in
          development: the shape of a rail, so the page does not open on a gap. */}
      {rails.length === 0 && (
        <section className="mt-7" aria-hidden>
          <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-hidden px-4 pb-2">
            <TrendingSkeleton />
            <TrendingSkeleton />
            <TrendingSkeleton />
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
      {endingSoonSlides.length > 0 && (
        <div className="mt-6 lg:hidden">
          <HeroBanner slides={endingSoonSlides} isRTL={isRTL} />
        </div>
      )}



      {/* « À découvrir » — what no rail above shows, on a 2-up grid. Replaces
          the old "Featured estates" + "Recently added" duplicate sections
          (those rendered the same rows.slice as the trending rail).
          One header, one grid, the rest of the available data. */}
      {explore && (
        <section className="mt-9" aria-labelledby="home-explore-phone">
          <RailHeading
            id="home-explore-phone"
            layout="phone"
            isRTL={isRTL}
            eyebrow={t("home.rails.explore.eyebrow")}
            title={t("home.rails.explore.title")}
            sub={t("home.rails.explore.sub")}
            href={explore.href}
            seeAllLabel={t("home.seeAll")}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 px-4">
            {explore.rows.map((a) => (
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
              {t(`home.priceBuckets.${b.labelKey}`)}
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
            <span className="mazed-eyebrow">{t("home.browseCatalogue")}</span>
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
            <ArrowUpRight className="size-5 rtl:-scale-x-100" strokeWidth={2.5} />
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
      railsAbove={railsAbove}
      railsBelow={railsBelow}
      explore={explore}
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
    /** A rental's unit (0166): the slide must not show a month's rent as a price. */
    tndPerMonth: string;
    bidCta: string;
    browseCta: string;
    brandTitle: string;
    brandSlogan: string;
    /** The eyebrow on the brand slide — the caller resolves the placeholder. */
    brandEyebrow: string;
    priceOnRequest: string;
    /** "Sfax · 450 m²" — one message, so the unit sits where each language wants it. */
    placeWithArea: (place: string, area: string) => string;
  },
): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const l of trending.slice(0, 5)) {
    const photo = (l.photos ?? []).slice().sort((p, q) => p.sort_order - q.sort_order)[0];
    if (!photo) continue;
    const area = Number((l.attributes ?? {}).area_sqm);
    const where = shownDelegation(l.governorate, l.delegation, locale) ?? governorateLabel(l.governorate, locale);
    slides.push({
      id: l.id,
      imageUrl: propertyPhotoUrl(photo.storage_path),
      eyebrow:
        Number.isFinite(area) && area > 0
          ? labels.placeWithArea(where, formatNumber(area, locale))
          : where,
      title: l.title,
      subtitle:
        l.price_on_request || l.price == null
          ? labels.priceOnRequest
          : `${formatTND(Number(l.price), locale)} ${l.deal_type === "rent" ? labels.tndPerMonth : labels.tnd}`,
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
  labels: { endingSoonWord: string; tnd: string; tndPerMonth: string; bidCta: string; priceOnRequest: string },
): HeroSlide[] {
  const slides: HeroSlide[] = [];
  for (const l of rows) {
    const photo = (l.photos ?? []).slice().sort((p, q) => p.sort_order - q.sort_order)[0];
    if (!photo) continue;
    slides.push({
      id: l.id,
      imageUrl: propertyPhotoUrl(photo.storage_path),
      eyebrow: `${labels.endingSoonWord} · ${shownDelegation(l.governorate, l.delegation, locale) ?? governorateLabel(l.governorate, locale)}`,
      title: l.title,
      subtitle:
        l.price_on_request || l.price == null
          ? labels.priceOnRequest
          : `${formatTND(Number(l.price), locale)} ${l.deal_type === "rent" ? labels.tndPerMonth : labels.tnd}`,
      href: `/annonces/${l.id}`,
      ctaLabel: labels.bidCta,
    });
  }
  return slides;
}


// ──────────────────────────────────────────────────────────────────────
// Browse-by-type / browse-by-price tables.
// ──────────────────────────────────────────────────────────────────────

// Labels come from `property.types.<key>`.
const PROPERTY_TYPES: {
  key: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { key: "apartment",  Icon: Building2 },
  { key: "villa",      Icon: Home },
  { key: "house",      Icon: Home },
  { key: "land",       Icon: Trees },
  // Fermes and Dépôts are categories in the catalogue with chips of their own;
  // the home tiles listed six of the eight, so two were unreachable from here.
  { key: "farm",       Icon: Wheat },
  { key: "commercial", Icon: Store },
  { key: "office",     Icon: Briefcase },
  { key: "warehouse",  Icon: Warehouse },
];

// Labels come from `home.priceBuckets.<labelKey>`.
const PRICE_BUCKETS: {
  key: string;
  labelKey: string;
  /** The params the catalogue reads (`min` / `max` in TND). Sale prices, so
   *  `deal=sale`: « Moins de 100k » listed every rental too otherwise. */
  query: string;
}[] = [
  { key: "under-100k",  labelKey: "under100k",      query: "deal=sale&max=99999" },
  { key: "100k-500k",   labelKey: "from100kTo500k", query: "deal=sale&min=100000&max=499999" },
  { key: "500k-1m",     labelKey: "from500kTo1m",   query: "deal=sale&min=500000&max=999999" },
  { key: "1m-plus",     labelKey: "over1m",         query: "deal=sale&min=1000000" },
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
