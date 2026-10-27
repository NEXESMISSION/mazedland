import { getTranslations, getLocale } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AutoRail } from "@/components/landing/AutoRail";
import { AnnonceCard } from "@/components/listing/AnnonceCard";
import { isRtl } from "@/lib/i18n";
import type { HomeRail } from "@/lib/home/rails";

/**
 * One rail of the home page — heading, « Tout voir », and the cards moving by
 * themselves — in either layout. The phone page and HomeDesktop each had their
 * own copy of this markup for three rails; with ten, one copy is what keeps
 * them looking like the same site.
 *
 * `layout` carries the only differences there were: the card width, the title
 * size, the spacing, and the arrows, which only a mouse needs.
 */

type Layout = "phone" | "desktop";

const SIZES: Record<Layout, { section: string; card: string; title: string; sub: string; cta: string }> = {
  phone: {
    section: "mt-7",
    card: "w-[230px]",
    title: "text-[19px]",
    sub: "text-[12px]",
    cta: "px-3 text-[11px]",
  },
  desktop: {
    section: "mt-12",
    card: "w-[300px]",
    title: "text-[20px]",
    sub: "text-[13px]",
    cta: "px-3.5 text-[11.5px]",
  },
};

export async function HomeRailSection({
  rail,
  layout,
  savedIds,
  loggedIn,
}: {
  rail: HomeRail;
  layout: Layout;
  savedIds: Set<string>;
  loggedIn: boolean;
}) {
  const t = await getTranslations();
  const isRTL = isRtl(await getLocale());
  const size = SIZES[layout];
  // Both layouts are in the page at once (CSS shows one), so the id says which.
  const headingId = `home-rail-${layout}-${rail.key}`;

  return (
    <section className={size.section} aria-labelledby={headingId}>
      <RailHeading
        id={headingId}
        layout={layout}
        isRTL={isRTL}
        eyebrow={t(`home.rails.${rail.key}.eyebrow`)}
        title={t(`home.rails.${rail.key}.title`)}
        sub={t(`home.rails.${rail.key}.sub`)}
        count={rail.rows.length}
        href={rail.href}
        seeAllLabel={t("home.seeAll")}
      />
      <AutoRail arrows={layout === "desktop"}>
        {rail.rows.map((a) => (
          <div key={a.id} className={`${size.card} shrink-0 snap-start`}>
            <AnnonceCard listing={a} saved={savedIds.has(a.id)} loggedIn={loggedIn} />
          </div>
        ))}
        {/* Room after the last card, so it does not sit on the screen's edge. */}
        <div className="w-1 shrink-0" />
      </AutoRail>
    </section>
  );
}

/**
 * A rail's heading: gold eyebrow, title with its count, a small line under it,
 * and « Tout voir » at the end. Also heads the phone's « À découvrir » grid.
 */
export function RailHeading({
  id,
  layout,
  isRTL,
  eyebrow,
  title,
  sub,
  count,
  href,
  seeAllLabel,
}: {
  id?: string;
  layout: Layout;
  isRTL: boolean;
  eyebrow?: string;
  title: string;
  sub?: string;
  count?: number;
  /** The catalogue search the section is the first cards of. */
  href: string;
  seeAllLabel: string;
}) {
  const size = SIZES[layout];
  const arabic = isRTL ? "font-arabic" : "";
  return (
    <div className="flex items-end justify-between gap-3 px-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="mazed-gold-rule-short" />
            <span className={`mazed-eyebrow ${isRTL ? "font-arabic tracking-[0.18em]" : ""}`}>{eyebrow}</span>
          </div>
        )}
        <h3
          id={id}
          className={`inline-flex items-center gap-2 ${size.title} font-extrabold leading-tight tracking-tight ${arabic}`}
        >
          {title}
          {count !== undefined && (
            // Count as a soft gold chip rather than naked parens — reads as
            // "7 of these" instead of debug metadata.
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gold-faint px-2.5 text-[11px] font-extrabold tracking-wider text-gold-bright">
              {count}
            </span>
          )}
        </h3>
        {sub && <p className={`mt-1 ${size.sub} leading-snug text-muted ${arabic}`}>{sub}</p>}
      </div>
      <Link
        href={href as "/annonces"}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface py-1.5 font-semibold text-muted transition-colors hover:border-gold-soft/40 hover:text-gold ${size.cta}`}
      >
        {seeAllLabel}
        <ChevronRight className="size-3 rtl:-scale-x-100" />
      </Link>
    </div>
  );
}
