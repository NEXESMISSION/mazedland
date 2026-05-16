import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import { getServerSupabase } from "@/lib/supabase/server";
import { Gavel, Lock } from "lucide-react";

/**
 * Vertical "live activity" feed — three rows tall, content scrolls
 * upward in an infinite loop. Each row is a recent bid: bidder initial,
 * auction title, amount, and how long ago. Sealed-bid amounts are
 * masked (RLS keeps them server-side too) so the feed never leaks the
 * high-water mark.
 *
 * Placeholder activity kicks in when the DB is empty so the landing
 * feels live on a fresh boot.
 */
export async function RecentBidsFeed() {
  const locale = await getLocale();

  let items: BidActivity[] = [];
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase
      .from("bids")
      .select(`
        id, amount, placed_at, bidder_id,
        auction:auctions!inner (
          id, type, status,
          property:properties!inner (title, governorate, status)
        )
      `)
      .order("placed_at", { ascending: false })
      .limit(15);
    items = (data ?? []).map((b) => {
      const a = (b as unknown as {
        auction: {
          id: string;
          type: "english" | "sealed" | "dutch";
          status: string;
          property: { title: string; governorate: string };
        };
      }).auction;
      return {
        id: b.id as string,
        auctionId: a.id,
        title: a.property.title,
        governorate: a.property.governorate,
        amount: Number(b.amount),
        sealed: a.type === "sealed" && !a.status.startsWith("ended"),
        bidderInitial: String(b.bidder_id).slice(0, 1).toUpperCase(),
        placedAt: b.placed_at as string,
      };
    });
  } catch {
    items = [];
  }

  if (items.length === 0) items = PLACEHOLDERS;

  return (
    <section className="px-4">
      <div className="batta-frame relative h-[132px] overflow-hidden">
        {/* Edge fades for soft entry/exit at the strip's top and bottom. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-batta-surface to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-batta-surface-2 to-transparent" />

        {/* The track holds the items twice — when the first copy has
            scrolled out completely (translateY -50%) the second copy
            is in the original position, so the loop is seamless. */}
        <div className="batta-marquee-y absolute inset-x-0 top-0 gap-0">
          {items.map((it) => (
            <BidRow key={`a-${it.id}`} item={it} locale={locale} />
          ))}
          {items.map((it) => (
            <BidRow key={`b-${it.id}`} item={it} locale={locale} ariaHidden />
          ))}
        </div>
      </div>
    </section>
  );
}

type BidActivity = {
  id: string;
  auctionId: string;
  title: string;
  governorate: string;
  amount: number;
  sealed: boolean;
  bidderInitial: string;
  placedAt: string;
};

function BidRow({
  item,
  locale,
  ariaHidden,
}: {
  item: BidActivity;
  locale: string;
  ariaHidden?: boolean;
}) {
  const isPlaceholder = item.auctionId.startsWith("placeholder-");
  const href = isPlaceholder
    ? ("/properties" as const)
    : (`/auctions/${item.auctionId}` as `/auctions/${string}`);
  return (
    <Link
      href={href}
      className="flex h-11 shrink-0 items-center gap-3 px-3 transition active:bg-batta-cream/5"
      aria-hidden={ariaHidden}
    >
      <span className="batta-monogram size-7 shrink-0 not-italic text-[11px] font-bold">
        {item.bidderInitial || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 truncate text-xs">
          <Gavel className="size-3 shrink-0 text-batta-gold" strokeWidth={1.75} />
          <span className="font-semibold text-batta-cream">{item.title}</span>
          <span className="text-batta-muted">·</span>
          <span className="truncate text-batta-cream/65">{item.governorate}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-batta-muted">
          {timeAgo(item.placedAt)}
        </div>
      </div>
      <span className="batta-tabular inline-flex shrink-0 items-center gap-1 text-xs font-bold">
        {item.sealed ? (
          <>
            <Lock className="size-3 text-batta-muted" strokeWidth={1.75} />
            <span className="text-[10px] uppercase tracking-wider text-batta-muted">sealed</span>
          </>
        ) : (
          <span className="batta-gold-text">{formatTND(item.amount, locale)}</span>
        )}
      </span>
    </Link>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const PLACEHOLDERS: BidActivity[] = [
  {
    id: "p1", auctionId: "placeholder-1", title: "Villa Sidi Bou Said",
    governorate: "Tunis", amount: 850_000, sealed: false,
    bidderInitial: "M", placedAt: agoIso(45),
  },
  {
    id: "p2", auctionId: "placeholder-2", title: "Appartement S+3 La Marsa",
    governorate: "Tunis", amount: 425_000, sealed: false,
    bidderInitial: "A", placedAt: agoIso(120),
  },
  {
    id: "p3", auctionId: "placeholder-3", title: "Terrain agricole",
    governorate: "Nabeul", amount: 0, sealed: true,
    bidderInitial: "S", placedAt: agoIso(240),
  },
  {
    id: "p4", auctionId: "placeholder-4", title: "Local commercial",
    governorate: "Sousse", amount: 320_000, sealed: false,
    bidderInitial: "K", placedAt: agoIso(360),
  },
  {
    id: "p5", auctionId: "placeholder-5", title: "Maison de campagne",
    governorate: "Bizerte", amount: 180_000, sealed: false,
    bidderInitial: "Y", placedAt: agoIso(540),
  },
  {
    id: "p6", auctionId: "placeholder-6", title: "Duplex centre-ville",
    governorate: "Sfax", amount: 525_000, sealed: false,
    bidderInitial: "H", placedAt: agoIso(720),
  },
];

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}
