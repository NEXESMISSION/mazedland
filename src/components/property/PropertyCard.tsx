import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatTND, minBidIncrement } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";
import { ArrowUpRight, Gavel, Users, Tag } from "lucide-react";
import { propertyPhotoUrl, isStaticSeedPath } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { WatchlistButton } from "@/components/watchlist/WatchlistButton";
import { LiveTimer } from "@/components/landing/LiveTimer";
import { StartBiddingButton } from "@/components/auction/StartBiddingButton";

/**
 * Image-forward auction card — ported from the mazed-auto AuctionCard.
 *
 * The whole card is the photograph. The body underneath (title + price
 * row) sits naked on the page background, no card chrome. This is the
 * single biggest visual move from the previous pass: instead of a boxy
 * tile with internal padding, the page reads as a magazine spread of
 * cropped photos with a tight label set beneath each.
 *
 *   - 4:5 portrait photo on `surface-2` with a 1px hairline ring that
 *     animates to gold on hover.
 *   - Status pill (Live countdown or Ended) top-leading; the watchlist
 *     heart sits bottom-leading, the rotating gold arrow chip bottom-
 *     trailing — the same corner choreography auto uses.
 *   - Title: bold Jakarta, line-clamped. The auction code (last 4 of
 *     the id) lives in mono on the trailing edge so each card has a
 *     "lot · A2F4" identity without needing a separate badge.
 *   - Price: `gradient-gold-text` so the trophy figure is the gold
 *     thing on an otherwise quiet card.
 */
export async function PropertyCard({
  auction,
  saved = false,
  loggedIn = false,
  priority = false,
}: {
  auction: AuctionWithProperty;
  /** Pre-resolved watchlist membership for this user. Defaults false (anon). */
  saved?: boolean;
  loggedIn?: boolean;
  /** Eager-load + high-priority fetch for above-the-fold cards. */
  priority?: boolean;
  /**
   * Legacy prop — older callers pass `variant="classic"` from the
   * white-card auctions view. Dark mode only now, so we accept and
   * ignore it. Kept on the type so type-checking doesn't break for
   * downstream consumers mid-refactor.
   */
  variant?: "default" | "classic";
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const property = auction.property;
  const heroPhoto = property.photos?.sort((a, b) => a.sort_order - b.sort_order)[0];
  const isLive = auction.status === "live" || auction.status === "extending";
  const isEnded =
    auction.status === "ended_sold" ||
    auction.status === "ended_unsold" ||
    auction.status === "cancelled";
  const price = auction.current_price ?? auction.opening_price;
  const nextStep = minBidIncrement(price);
  const isEnglish = auction.type === "english";
  // Last 4 of the auction id, uppercase. Adds the "lot A2F4"
  // auction-catalogue affordance without changing the data model.
  const lotNo = String(auction.id).replace(/-/g, "").slice(-4).toUpperCase();

  return (
    <div className="block">
      {/* The clickable area is a STRETCHED LINK overlay (absolute inset-0), NOT
          an <a> wrapping the whole card — wrapping nests the WatchlistButton
          <button> inside an <a> (invalid HTML; breaks assistive tech +
          hydration). The heart sits ABOVE the link via z-index so it stays
          independently clickable; StartBiddingButton stays OUTSIDE this wrapper
          so the overlay never covers it. */}
      <div className="group relative block">
        <div className="relative">
        {/* PHOTO — the only surface on the card */}
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border transition-all duration-300 group-hover:ring-gold-soft/40">
          {heroPhoto ? (
            // Plain public/object URL — Next/Image does its own
            // resizing via /_next/image. Don't stack Supabase's
            // /render/image transform on top: projects without the
            // transformations add-on return 400 from that endpoint
            // and the image silently fails to load.
            //
            // blurDataURL: if this photo is a seeded listing we have a
            // pre-baked 16-px blur in IMAGE_BLUR_MAP. Otherwise fall
            // back to "empty" (no placeholder) — real uploads don't
            // have a blur yet.
            (() => {
              const src = propertyPhotoUrl(heroPhoto.storage_path);
              const blur = IMAGE_BLUR_MAP[heroPhoto.storage_path];
              // Skip /_next/image for static seed photos — they're already
              // small webps and the optimizer's cold-function round-trip
              // dwarfs the file fetch itself.
              const unoptimized = isStaticSeedPath(src);
              return (
                <Image
                  src={src}
                  alt={property.title}
                  fill
                  sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
                  priority={priority}
                  placeholder={blur ? "blur" : "empty"}
                  blurDataURL={blur}
                  unoptimized={unoptimized}
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              );
            })()
          ) : (
            <div className="flex h-full items-center justify-center text-5xl text-foreground/15">
              🏛️
            </div>
          )}

          {/* Subtle bottom gradient so the gold arrow chip stays readable */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

          {/* Ended overlay desaturates the photo so an over auction
              reads as inactive at a glance. */}
          {isEnded && (
            <div className="pointer-events-none absolute inset-0 bg-black/55 mix-blend-multiply" />
          )}

          {/* Single status chip — top-leading. Merges the LIVE pulse and
              the countdown into one pill so the photo isn't busy with
              two competing overlays. Ended uses the same shape, just
              red and static. Non-live shows the auction-type pill. */}
          <div className="absolute top-2.5 start-2.5">
            {isEnded ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-red-500 px-2.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-[0_0_18px_rgba(239,68,68,0.55)]">
                <span className="size-1.5 rounded-full bg-white" />
                {auction.status === "ended_sold" ? t("auction.sold") : t("auction.ended")}
              </span>
            ) : isLive ? (
              <span className="glass inline-flex h-7 items-center gap-1.5 rounded-full px-2.5">
                <span className="batta-pulse-dot size-1.5 rounded-full bg-red-500" />
                <LiveTimer
                  endsAt={auction.ends_at}
                  className="batta-tabular text-[10.5px] font-bold text-foreground"
                />
              </span>
            ) : (
              <span className="batta-gold-fill inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
                <Tag className="size-3" strokeWidth={2.5} />
                {t(`auction.types.${auction.type}`)}
              </span>
            )}
          </div>

          {/* Bottom-leading — watchlist heart. z-20 keeps it ABOVE the
              stretched card link (z-10) so its button still receives clicks. */}
          <div className="absolute bottom-2.5 start-2.5 z-20">
            <WatchlistButton
              auctionId={auction.id}
              initialSaved={saved}
              loggedIn={loggedIn}
              size="sm"
            />
          </div>

          {/* Bottom-trailing — polished-brass arrow chip. Gold gradient
              fill (matches the FAB / splash / modal header) so the
              affordance feels metallic, not flat. Rotates on hover. */}
          <div className="absolute bottom-2.5 end-2.5">
            <span className="batta-gradient-gold inline-flex h-9 w-9 items-center justify-center rounded-full text-white ring-1 ring-black/5 shadow-[var(--shadow-gold)] transition-transform group-hover:scale-110 group-hover:rotate-45">
              <ArrowUpRight className="size-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>

        {/* BODY — naked, sits on the page. No padding/box. */}
        <div className="space-y-1 px-1 pt-3">
          <div className="flex items-start justify-between gap-2">
            {/* dir="auto" lets the title's first strong directional
                character pick truncation side: Latin titles ellipsis at
                the right (visual end), Arabic titles at the left. Fixes
                the "...Appartement S+1 · Centre-" wrong-side cut. */}
            <h3
              dir="auto"
              className={`line-clamp-1 flex-1 text-[15px] font-bold leading-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              {property.title}
              <span className="ms-1 text-[12px] font-medium text-muted">
                · {property.governorate}
              </span>
            </h3>
            <span className="batta-tabular mt-0.5 shrink-0 font-mono text-[9px] font-bold tracking-[0.05em] text-subtle">
              {lotNo}
            </span>
          </div>

          {/* Price + activity row. Price wraps the number + currency in
              a single `dir="ltr"` so "261.000 TND" doesn't get reordered
              into "TND 261.000" in an RTL container, and the bid-step
              `+5,000` keeps the plus sign on the left where the eye
              expects it. */}
          <div className="flex items-center justify-between gap-2">
            <span
              dir="ltr"
              className="batta-tabular gradient-gold-text inline-flex items-baseline gap-1 text-base font-extrabold"
            >
              {formatTND(price, locale)}
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                {t("common.tnd")}
              </span>
            </span>
            {isEnglish ? (
              <span
                dir="ltr"
                className="batta-tabular inline-flex items-center gap-1 text-[11px] text-muted"
                title="Bid step"
              >
                <Gavel className="size-3" strokeWidth={2} />
                +{formatTND(nextStep, locale)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                <Users className="size-3" strokeWidth={2} />
                {t(`auction.types.${auction.type}`)}
              </span>
            )}
          </div>
        </div>
        </div>
        {/* Stretched link — makes the whole card-content clickable without
            wrapping the interactive heart in an <a>. z-10 sits under the
            heart's z-20; the StartBiddingButton below is outside this wrapper. */}
        <Link
          href={`/auctions/${auction.id}`}
          aria-label={property.title}
          className="absolute inset-0 z-10"
        >
          <span className="sr-only">{property.title}</span>
        </Link>
      </div>
      <StartBiddingButton auctionId={auction.id} isLive={isLive} />
    </div>
  );
}

