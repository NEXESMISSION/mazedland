import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LiveTicker } from "@/components/landing/LiveTicker";
import { TrendingRail } from "@/components/landing/TrendingRail";
import { EndingSoonBanner } from "@/components/landing/EndingSoonBanner";
import { HeroBanner, type HeroSlide } from "@/components/landing/HeroBanner";
import { HomeSearch } from "@/components/landing/HomeSearch";
import { PropertyCard } from "@/components/property/PropertyCard";
import type { AuctionWithProperty } from "@/lib/types";
import {
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Building2,
  Gavel,
  ShieldCheck,
  ClipboardCheck,
  Scale,
  Lock,
  CheckCircle2,
  Zap,
  Users,
} from "lucide-react";

/**
 * Desktop (lg+) home surface — a ground-up layout for mouse + wide
 * viewports, kept in its own file so the mobile tree in the route's
 * page.tsx is never touched. Rendered behind `hidden lg:block`, so it
 * costs nothing on phones.
 *
 * Design language:
 *   - A CENTERED hero: brand headline + a prominent one-row search +
 *     a centered live-stats strip. No off-center side boxes.
 *   - Every listing section is an AUTO-SLIDING carousel (TrendingRail),
 *     not a static grid — the page breathes and rotates on its own.
 *   - Editorial bands (how-it-works, trust, activity, closing spread)
 *     close the page.
 */

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

// Labels come from i18n (`property.types.<key>`); the tile art is a
// pre-optimized illustration at /icons/<key>.{avif,webp}.
const PROPERTY_TYPES: { key: string }[] = [
  { key: "apartment" },
  { key: "villa" },
  { key: "house" },
  { key: "land" },
  { key: "commercial" },
  { key: "office" },
];

const PRICE_BUCKETS: { key: string; label: string }[] = [
  { key: "under-100k", label: "Moins de 100k" },
  { key: "100k-500k",  label: "100k – 500k" },
  { key: "500k-1m",    label: "500k – 1M" },
  { key: "1m-plus",    label: "1M+ TND" },
];

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

export async function HomeDesktop({
  heroSlides,
  trending,
  offers,
  nouveautes,
  recent,
  savedIds,
  loggedIn,
  liveCount,
  soldThisMonthCount,
  coverageGovs,
}: {
  heroSlides: HeroSlide[];
  trending: AuctionWithProperty[];
  offers: AuctionWithProperty[];
  nouveautes: AuctionWithProperty[];
  recent: AuctionWithProperty[];
  hammered: HammeredRow[];
  savedIds: Set<string>;
  loggedIn: boolean;
  liveCount: number;
  scheduledCount: number;
  soldThisMonthCount: number;
  coverageGovs: number;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  const stats = [
    { value: liveCount,          label: "Enchères en cours", sub: "En temps réel",   Icon: Gavel,        wrap: "bg-red-50 text-red-500",         num: "text-red-500" },
    { value: soldThisMonthCount, label: "Vendues ce mois-ci", sub: "Biens attribués", Icon: CheckCircle2, wrap: "bg-emerald-50 text-emerald-600", num: "text-emerald-600" },
    { value: coverageGovs,       label: "Gouvernorats",      sub: "Actif",            Icon: Building2,    wrap: "bg-violet-50 text-violet-600",   num: "text-violet-600" },
  ];

  return (
    <div className="hidden lg:block mx-auto max-w-[var(--max-w-wide)] px-8 pb-24">
      {/* ─── SPLIT HERO — copy + search left, lot imagery right ─── */}
      <section className="pt-8">
        <div className="grid grid-cols-12 items-center gap-10">
          {/* LEFT — brand copy + trust pillars */}
          <div className="col-span-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[12px] font-bold shadow-sm">
              <span
                aria-hidden
                className="batta-pulse-dot size-2 rounded-full bg-[var(--accent)] text-[var(--accent)]/40"
              />
              <span className="uppercase tracking-[0.08em] text-[var(--accent)]">En direct</span>
              <span className="text-muted">· {liveCount} enchères en cours</span>
            </span>

            <h1
              className={`mt-6 text-balance text-[clamp(32px,3vw,46px)] font-extrabold leading-[1.08] tracking-tight text-foreground ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              {(() => {
                const title = t("home.heroBrandTitle");
                const idx = title.lastIndexOf(" ");
                const head = idx > 0 ? title.slice(0, idx) : title;
                const last = idx > 0 ? title.slice(idx + 1) : "";
                return (
                  <>
                    {head} <span className="gradient-gold-text">{last}.</span>
                  </>
                );
              })()}
            </h1>

            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
              {t("brand.slogan")}
            </p>

            <div className="mt-7 flex flex-wrap gap-x-7 gap-y-4">
              {[
                { Icon: ShieldCheck, title: "100% sécurisé", sub: "Transactions vérifiées" },
                { Icon: Zap,         title: "Rapidité",      sub: "Processus optimisés" },
                { Icon: Users,       title: "Confiance",     sub: "Accompagnement dédié" },
              ].map((it) => (
                <div key={it.title} className="flex items-center gap-2.5">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/15">
                    <it.Icon className="size-4" strokeWidth={2} />
                  </span>
                  <div>
                    <div className="text-[13px] font-bold leading-tight text-foreground">{it.title}</div>
                    <div className="text-[11px] text-muted">{it.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — auto-sliding hero carousel (same engine as mobile).
              The wrapper cancels HeroBanner's own mobile px-4/pt-4 so the
              banner sits flush in the column; its inner rounded ring frames it. */}
          <div className="col-span-6 [&>section]:!px-0 [&>section]:!pt-0">
            <HeroBanner slides={heroSlides} isRTL={isRTL} />
          </div>
        </div>

        {/* Search — full width under the split */}
        <div className="mt-8">
          <HomeSearch isRTL={isRTL} layout="bar" />
        </div>

        {/* Live-stats strip — icon badge + figure + label + sublabel. */}
        <div className="mt-6 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl bg-surface ring-1 ring-border rtl:divide-x-reverse">
          {stats.map(({ value, label, sub, Icon, wrap, num }) => (
            <div key={label} className="flex items-center gap-3 px-6 py-5">
              <span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full ${wrap}`}>
                <Icon className="size-5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className={`batta-tabular text-[26px] font-extrabold leading-none ${num}`}>
                  {value.toLocaleString("fr-FR")}
                </div>
                <div className="mt-1 text-[12.5px] font-bold leading-tight text-foreground">{label}</div>
                <div className="text-[10.5px] text-muted">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* LIVE TICKER */}
      <section className="mt-10">
        <LiveTicker />
      </section>

      {/* TRENDING — auto-sliding carousel */}
      {trending.length > 0 && (
        <section className="mt-12">
          <RailHeader
            eyebrow={t("home.trendingEyebrow")}
            title={t("home.trendingTitle")}
            countLabel={trending.length}
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
          />
          <CardSlider
            items={trending}
            savedIds={savedIds}
            loggedIn={loggedIn}
            priorityCount={4}
          />
        </section>
      )}

      {/* OFFRES DIRECTES — auto-sliding carousel */}
      {offers.length > 0 && (
        <section className="mt-12">
          <RailHeader
            eyebrow="Achat immédiat"
            title="Offres directes"
            countLabel={offers.length}
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
          />
          <CardSlider items={offers} savedIds={savedIds} loggedIn={loggedIn} />
        </section>
      )}

      {/* NOUVEAUTÉS — auto-sliding carousel */}
      {nouveautes.length > 0 && (
        <section className="mt-12">
          <RailHeader
            eyebrow={t("home.nouveautesEyebrow")}
            title={t("home.nouveautesTitle")}
            countLabel={nouveautes.length}
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
          />
          <CardSlider items={nouveautes} savedIds={savedIds} loggedIn={loggedIn} />
        </section>
      )}

      {/* ENDING SOON band */}
      <section className="mt-12">
        <EndingSoonBanner />
      </section>

      {/* PARCOURIR — category tiles (one row) + price pills */}
      <section className="mt-14">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="batta-eyebrow">Parcourir</span>
            <h3 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
              Trouvez votre bien
            </h3>
          </div>
          <Link
            href="/properties"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[11.5px] font-semibold text-muted transition-colors hover:border-gold-soft/40 hover:text-gold"
          >
            {t("home.seeAll")}
            <ChevronEnd className="size-3" />
          </Link>
        </div>

        {/* Type — six compact category tiles across one row. */}
        <div className="mt-6 grid grid-cols-6 gap-3">
          {PROPERTY_TYPES.map((pt) => (
            <Link
              key={pt.key}
              href={`/properties?types=${pt.key}` as `/properties`}
              className="group flex flex-col items-center gap-2 rounded-2xl bg-surface px-3 py-5 ring-1 ring-border transition hover:-translate-y-0.5 hover:bg-surface-2 hover:ring-gold-soft/50"
            >
              <picture>
                <source srcSet={`/icons/${pt.key}.avif`} type="image/avif" />
                <source srcSet={`/icons/${pt.key}.webp`} type="image/webp" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/icons/${pt.key}.webp`}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  className="size-16 transition-transform duration-300 group-hover:scale-105"
                />
              </picture>
              <span className="text-[12.5px] font-bold text-foreground">
                {t(`property.types.${pt.key}`)}
              </span>
            </Link>
          ))}
        </div>

        {/* Price — four pills across one row. */}
        <div className="mt-3 grid grid-cols-4 gap-3">
          {PRICE_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={`/properties?price=${b.key}` as `/properties`}
              className="group flex items-center justify-between rounded-2xl bg-surface px-5 py-3.5 ring-1 ring-border transition hover:bg-gold-faint hover:ring-gold-soft/50"
            >
              <span className="text-[13px] font-bold text-foreground">{b.label}</span>
              <ArrowUpRight
                className="size-4 text-muted transition group-hover:text-gold-bright"
                strokeWidth={2.2}
              />
            </Link>
          ))}
        </div>
      </section>

      {/* MORE TO EXPLORE — auto-sliding carousel */}
      {recent.length > 0 && (
        <section className="mt-14">
          <RailHeader
            title={t("home.moreToExplore")}
            ChevronEnd={ChevronEnd}
            isRTL={isRTL}
            seeAllLabel={t("home.seeAll")}
          />
          <CardSlider items={recent} savedIds={savedIds} loggedIn={loggedIn} />
        </section>
      )}

      {/* ─── POURQUOI BATTA — one consolidated trust + CTA band ───
              Replaces the old how-it-works / trust / activity / closing
              stack: a single navy value panel + the four trust pillars. */}
      <section className="mt-16">
        <div className="overflow-hidden rounded-3xl ring-1 ring-gold/25">
          <div className="grid grid-cols-12">
            {/* Value prop + CTA */}
            <div className="batta-surface-navy-luxe relative col-span-5 flex flex-col justify-center p-10">
              <span className="batta-eyebrow">{t("home.trustEyebrow")}</span>
              <h2 className="mt-3 text-[28px] font-extrabold leading-[1.12] tracking-tight">
                {t("home.trustTitle")}
              </h2>
              <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-muted">
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

            {/* Four trust pillars — 2×2, hairline-divided. */}
            <div className="col-span-7 grid grid-cols-2 gap-px bg-border">
              {TRUST_PILLARS.map((p) => (
                <div key={p.key} className="flex flex-col gap-2.5 bg-surface p-7">
                  <span className="batta-monogram batta-monogram-filled size-11 text-gold">
                    <p.Icon className="size-4" strokeWidth={2.2} />
                  </span>
                  <div className="text-[14.5px] font-bold leading-tight text-foreground">
                    {t(p.titleKey)}
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted">
                    {t(p.bodyKey)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
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

/** Section header — eyebrow + title + count chip + "see all" link. */
function RailHeader({
  eyebrow,
  title,
  countLabel,
  ChevronEnd,
  isRTL,
  seeAllLabel,
}: {
  eyebrow?: string;
  title: string;
  countLabel?: number;
  ChevronEnd: React.ComponentType<{ className?: string }>;
  isRTL: boolean;
  seeAllLabel: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="batta-gold-rule-short" />
            <span className={`batta-eyebrow ${isRTL ? "font-arabic tracking-[0.18em]" : ""}`}>
              {eyebrow}
            </span>
          </div>
        )}
        <h3 className="inline-flex items-center gap-2 text-[20px] font-extrabold leading-tight tracking-tight">
          {title}
          {countLabel !== undefined && (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gold-faint px-2.5 text-[11px] font-extrabold tracking-wider text-gold-bright">
              {countLabel}
            </span>
          )}
        </h3>
      </div>
      <Link
        href="/properties"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[11.5px] font-semibold text-muted transition-colors hover:border-gold-soft/40 hover:text-gold"
      >
        {seeAllLabel}
        <ChevronEnd className="size-3" />
      </Link>
    </div>
  );
}

/** Auto-sliding property carousel (wraps the shared TrendingRail). */
function CardSlider({
  items,
  savedIds,
  loggedIn,
  priorityCount = 0,
}: {
  items: AuctionWithProperty[];
  savedIds: Set<string>;
  loggedIn: boolean;
  priorityCount?: number;
}) {
  return (
    <TrendingRail arrows>
      {items.map((a, i) => (
        <div key={a.id} className="w-[300px] shrink-0 snap-start">
          <PropertyCard
            auction={a}
            saved={savedIds.has(a.id)}
            loggedIn={loggedIn}
            priority={i < priorityCount}
          />
        </div>
      ))}
      <div className="w-1 shrink-0" />
    </TrendingRail>
  );
}
