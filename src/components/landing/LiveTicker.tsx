import { getLocale, getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { Clock } from "lucide-react";
import { LiveTimer } from "./LiveTimer";

/**
 * Live-ticker rows are SHARED across all visitors (public live auctions,
 * no per-user scoping), so we cache the query for 45s with the cookieless
 * service-role client instead of re-querying Supabase on every pageview.
 * Same pattern as the home feed (see (home)/page.tsx getHomeFeed). Tagged
 * "home-feed" so a single revalidateTag refreshes the whole home surface.
 */
const getLiveTickerItems = unstable_cache(
  async (): Promise<TickerItem[]> => {
    const sb = getServiceSupabase();
    if (!sb) return [];
    const end = log.scope("home:ticker").time("MISS query live(10)");
    try {
      const { data } = await sb
        .from("auctions")
        .select(`
          id, current_price, opening_price, status, ends_at,
          property:properties!inner (title, governorate, status)
        `)
        .in("status", ["live", "extending"])
        .eq("property.status", "ready")
        .order("ends_at", { ascending: true })
        .limit(10);
      end();
      return (data ?? []).map((a) => {
        const p = (a as unknown as { property: { title: string; governorate: string } }).property;
        return {
          id: a.id as string,
          title: p.title,
          governorate: p.governorate,
          price: Number(a.current_price ?? a.opening_price),
          endsAt: a.ends_at as string,
          live: true,
        };
      });
    } catch {
      return [];
    }
  },
  ["live-ticker"],
  { revalidate: 45, tags: ["home-feed"] },
);

/**
 * Auto-scrolling marquee of LIVE auctions. CSS-only loop (see
 * .batta-marquee in globals.css) — the track holds the items twice so
 * the wrap-around is seamless at the seam.
 *
 * Strictly real data: if Supabase returns zero live rows we render
 * nothing. A fake placeholder ticker reads as "look how alive we are"
 * but is misleading when the catalogue is actually empty — better to
 * stay silent than to lie on the homepage.
 */
export async function LiveTicker() {
  const t = await getTranslations();
  const locale = await getLocale();

  const items = await getLiveTickerItems();

  // Empty catalogue → render nothing. The home page's other rails
  // already absorb the "we're loading" state; an empty ticker doesn't
  // need a stand-in.
  if (items.length === 0) return null;

  // The CSS marquee translates 0 → -50% of the track, which only loops
  // seamlessly when ONE copy (= half the track) is at least the
  // viewport width. With only a few auctions the half-track is narrower
  // than the screen, leaving a visible empty gap between cycles — the
  // "the bar breaks and is empty" bug.
  //
  // Pad the per-copy item list until each copy holds at least
  // MIN_ITEMS_PER_COPY cells. A cell is ~220-280px, so 12 cells ≈
  // 3000px which covers any realistic viewport. We then render the
  // padded sequence twice — the animation is unchanged.
  const MIN_ITEMS_PER_COPY = 12;
  const reps = Math.max(1, Math.ceil(MIN_ITEMS_PER_COPY / items.length));
  const sequence: TickerItem[] = [];
  for (let i = 0; i < reps; i++) sequence.push(...items);

  // Duplicate the (padded) list so the marquee loops without a visible
  // seam. aria-hidden the second copy so screen readers don't
  // double-read.
  return (
    <div
      className="relative overflow-hidden border-y border-batta-gold/20 bg-batta-surface/60 py-2.5 backdrop-blur-sm"
      role="region"
      aria-label={t("auction.live")}
    >
      {/* Edge fades so items don't visually pop in/out. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-batta-paper to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-batta-paper to-transparent" />
      {/* Slower than the default marquee duration (40s) — the live
          ticker shares the .batta-marquee animation with PartnersMarquee,
          so the override is inline to keep this surface calmer without
          slowing other marquees. animationPlayState is forced to
          "running" inline so the shared .batta-marquee:hover pause rule
          can't stop this ticker — the live signal never freezes, even
          on hover or while a finger sits on it. */}
      <ul
        className="batta-marquee"
        style={{ animationDuration: "160s", animationPlayState: "running" }}
      >
        {sequence.map((it, i) => (
          <TickerCell key={`a-${i}-${it.id}`} item={it} locale={locale} />
        ))}
        {sequence.map((it, i) => (
          <TickerCell key={`b-${i}-${it.id}`} item={it} locale={locale} ariaHidden />
        ))}
      </ul>
    </div>
  );
}

type TickerItem = {
  id: string;
  title: string;
  governorate: string;
  price: number;
  endsAt: string;
  live: boolean;
};

function TickerCell({
  item,
  locale,
  ariaHidden,
}: {
  item: TickerItem;
  locale: string;
  ariaHidden?: boolean;
}) {
  return (
    <Link
      href={`/auctions/${item.id}` as `/auctions/${string}`}
      className="contents"
    >
      <li
        className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-batta-surface-2 px-3 py-1 text-xs ring-1 ring-batta-gold/25 ltr:me-3 rtl:ms-3"
        aria-hidden={ariaHidden}
      >
        <span className="batta-pulse-dot inline-flex size-1.5 rounded-full bg-red-500 text-red-500/40" />
        <span className="font-semibold text-batta-cream">{item.title}</span>
        <span className="text-batta-muted">·</span>
        <span className="text-batta-cream/70">{item.governorate}</span>
        <span className="text-batta-muted">·</span>
        <span className="batta-gold-text batta-tabular font-bold">{formatTND(item.price, locale)}</span>
        <span className="text-batta-muted">·</span>
        <span className="inline-flex items-center gap-0.5 text-batta-cream/70">
          <Clock className="size-3" strokeWidth={1.75} />{" "}
          <LiveTimer endsAt={item.endsAt} className="font-semibold" />
        </span>
      </li>
    </Link>
  );
}
