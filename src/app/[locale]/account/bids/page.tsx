import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { formatTND } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { Gavel, MapPin } from "lucide-react";

/**
 * Consolidated bids history (audit #13). Aggregates per auction so the
 * same listing doesn't render five rows when the user bid five times —
 * we keep the highest bid as the headline.
 */
export default async function MyBidsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations();
  const dateLocale = await getLocale();
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data: bids } = await supabase
    .from("bids")
    .select(`
      auction_id, amount, max_amount, placed_at,
      auction:auctions (
        id, status, current_price, ends_at, winner_user_id,
        property:properties (
          title, governorate, type,
          photos:property_photos (id, storage_path, sort_order)
        )
      )
    `)
    .eq("bidder_id", user!.id)
    .order("placed_at", { ascending: false })
    .limit(200);

  type AuctionLite = {
    id: string;
    status: string;
    current_price: number | null;
    ends_at: string;
    winner_user_id: string | null;
    property: {
      title: string;
      governorate: string;
      type: string;
      photos: { id: string; storage_path: string; sort_order: number }[];
    };
  };
  type BidRow = {
    auction_id: string;
    amount: number;
    max_amount: number | null;
    placed_at: string;
    auction: AuctionLite | null;
  };

  const byAuction = new Map<string, BidRow>();
  for (const b of ((bids ?? []) as unknown as BidRow[])) {
    if (!b.auction) continue;
    const prev = byAuction.get(b.auction_id);
    if (!prev || Number(b.amount) > Number(prev.amount)) byAuction.set(b.auction_id, b);
  }
  const list = Array.from(byAuction.values()).sort((a, b) =>
    new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime(),
  );

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <span className="batta-eyebrow">Activity</span>
      <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        {t("bidsHistory.title")}
      </h1>

      {list.length === 0 ? (
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <Gavel className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">{t("bidsHistory.empty")}</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5 pb-6">
          {list.map((b) => {
            const a = b.auction!;
            const photo = a.property.photos?.sort((x, y) => x.sort_order - y.sort_order)[0];
            const isLive = a.status === "live" || a.status === "extending";
            const won = a.winner_user_id === user!.id
              && (a.status === "ended_sold" || a.status === "awarded");
            const outbid = !won
              && !isLive
              && (Number(a.current_price ?? 0) > Number(b.amount));

            const tone =
              won ? "batta-tone-ok"
              : outbid ? "bg-surface-2 text-muted border border-border"
              : isLive ? "batta-tone-bad"
              : "bg-gold-faint text-gold-bright border border-gold/30";
            const stateLabel =
              won ? t("bidsHistory.won")
              : outbid ? t("bidsHistory.outbid")
              : isLive ? t("bidsHistory.live")
              : t("bidsHistory.ended");

            return (
              <li
                key={b.auction_id}
                className="overflow-hidden rounded-xl bg-surface ring-1 ring-border transition-all hover:ring-gold-soft/40"
              >
                <Link
                  href={`/auctions/${a.id}` as `/auctions/${string}`}
                  className="flex gap-3 p-3"
                >
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                    {photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={propertyPhotoUrl(photo.storage_path)}
                        alt={a.property.title}
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-foreground">{a.property.title}</div>
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
                      <MapPin className="size-3 shrink-0" strokeWidth={2} />
                      {a.property.governorate}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-bold">
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-foreground/85 ring-1 ring-border">
                        {t("bidsHistory.yourBid")}: {formatTND(Number(b.amount), dateLocale)}
                      </span>
                      {b.max_amount && (
                        <span className="rounded-full bg-gold-faint px-2 py-0.5 text-gold-bright ring-1 ring-gold/30">
                          {t("bidsHistory.yourMax")}: {formatTND(Number(b.max_amount), dateLocale)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className={`flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
                  <span>{stateLabel}</span>
                  <span className="batta-tabular font-mono normal-case tracking-normal">
                    {formatTND(Number(a.current_price ?? 0), dateLocale)} {t("common.tnd")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
