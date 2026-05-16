import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty } from "@/lib/types";
import { Clock } from "lucide-react";
import { LiveTimer } from "./LiveTimer";

/**
 * Auto-scrolling marquee of live / soon-ending auctions. CSS-only loop
 * (see .batta-marquee in globals.css) — the track holds the items twice
 * so the wrap-around is seamless at the seam.
 *
 * Fail-soft: if Supabase is empty / unconfigured we render a curated set
 * of placeholder strings so the landing always shows movement and the
 * "this thing is alive" cue survives a fresh clone.
 */
export async function LiveTicker() {
  const t = await getTranslations();
  const locale = await getLocale();

  let items: TickerItem[] = [];
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase
      .from("auctions")
      .select(`
        id, current_price, opening_price, status, ends_at,
        property:properties!inner (title, governorate, status)
      `)
      .in("status", ["live", "extending"])
      .eq("property.status", "ready")
      .order("ends_at", { ascending: true })
      .limit(10);
    items = (data ?? []).map((a) => {
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
    items = [];
  }

  if (items.length === 0) {
    items = PLACEHOLDERS;
  }

  // Duplicate the list so the marquee loops without a visible seam.
  // aria-hidden the second copy so screen readers don't double-read.
  return (
    <div
      className="relative overflow-hidden border-y border-batta-gold/20 bg-batta-surface/60 py-2.5 backdrop-blur-sm"
      role="region"
      aria-label={t("auction.live")}
    >
      {/* Edge fades so items don't visually pop in/out. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-batta-paper to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-batta-paper to-transparent" />
      <ul className="batta-marquee">
        {items.map((it) => (
          <TickerCell key={`a-${it.id}`} item={it} locale={locale} />
        ))}
        {items.map((it) => (
          <TickerCell key={`b-${it.id}`} item={it} locale={locale} ariaHidden />
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
  const Inner = (
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
  );

  // Real items link to their auction; placeholders link to /properties so
  // the click is never a dead end.
  if (item.id.startsWith("placeholder-")) {
    return (
      <Link href="/properties" className="contents">
        {Inner}
      </Link>
    );
  }
  return (
    <Link href={`/auctions/${item.id}` as `/auctions/${string}`} className="contents">
      {Inner}
    </Link>
  );
}


// Curated placeholder set used when no real auctions exist — keeps the
// landing alive on the very first dev boot and gives marketing a
// realistic preview of the ticker.
const PLACEHOLDERS: TickerItem[] = [
  {
    id: "placeholder-1", title: "Villa Sidi Bou Said", governorate: "Tunis",
    price: 850_000, endsAt: isoIn(2, 14), live: true,
  },
  {
    id: "placeholder-2", title: "Appartement S+3 La Marsa", governorate: "Tunis",
    price: 420_000, endsAt: isoIn(0, 8), live: true,
  },
  {
    id: "placeholder-3", title: "Terrain agricole", governorate: "Nabeul",
    price: 95_000, endsAt: isoIn(1, 6), live: true,
  },
  {
    id: "placeholder-4", title: "Local commercial Avenue", governorate: "Sousse",
    price: 320_000, endsAt: isoIn(3, 2), live: true,
  },
  {
    id: "placeholder-5", title: "Maison de campagne", governorate: "Bizerte",
    price: 180_000, endsAt: isoIn(0, 12), live: true,
  },
  {
    id: "placeholder-6", title: "Duplex centre-ville", governorate: "Sfax",
    price: 520_000, endsAt: isoIn(4, 0), live: true,
  },
];

function isoIn(days: number, hours: number): string {
  return new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();
}
