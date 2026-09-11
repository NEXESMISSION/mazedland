import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import { ArrowUpRight, MapPin, Ruler, BedDouble } from "lucide-react";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { IMAGE_BLUR_MAP } from "@/lib/imageBlurMap";
import { FavoriteButton } from "@/components/property/FavoriteButton";

/**
 * One annonce, as a card.
 *
 * This is `PropertyCard` with the auction taken out — deliberately the SAME
 * visual language, because the design is not what is changing: 4:5 photo as
 * the entire surface, hairline ring that warms to gold on hover, the body
 * naked on the page background with no card chrome, and the price in
 * `gradient-gold-text` so the figure is the one gold thing on a quiet card.
 *
 * What the auction card put on the photo cannot be carried over, and the
 * replacements are not arbitrary:
 *
 *   LiveTimer countdown  → nothing. A fixed price has no clock, and a chip
 *                          counting down to nothing is worse than an empty
 *                          corner.
 *   auction-type pill    → the category (Villas, Terrains). It is the one
 *                          thing a buyer scanning a rail actually sorts on.
 *   bid step / bidders   → surface and rooms, pulled from `attributes`. On a
 *                          property site "120 m² · S+2" is the line that
 *                          decides whether the card is worth opening, and it
 *                          is the one that was missing entirely.
 *   lot number           → `reference` (BT-00042). Same corner, same mono
 *                          treatment, but now it is a number the seller and
 *                          the office can both say out loud on the telephone.
 *   StartBiddingButton   → nothing. The action is a phone call, and the number
 *                          is deliberately not on this page (see
 *                          `/annonces/[id]`).
 */

export type AnnonceCardRow = {
  id: string;
  title: string;
  price: number | string | null;
  price_on_request: boolean;
  negotiable: boolean;
  governorate: string;
  delegation: string | null;
  reference: string | null;
  attributes: Record<string, unknown> | null;
  category: { label_fr: string } | { label_fr: string }[] | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export async function AnnonceCard({
  listing,
  saved = false,
  loggedIn = false,
}: {
  listing: AnnonceCardRow;
  /** Pre-resolved favourite membership for this user. Defaults false (anon). */
  saved?: boolean;
  loggedIn?: boolean;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  const category = one(listing.category);
  const heroPhoto = (listing.photos ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)[0];

  const attrs = (listing.attributes ?? {}) as Record<string, unknown>;
  const area = Number(attrs.area_sqm);
  const rooms = Number(attrs.rooms);
  const where = listing.delegation?.trim() || listing.governorate;

  return (
    <div className="block">
      {/* The clickable area is a STRETCHED LINK overlay (absolute inset-0), NOT
          an <a> wrapping the whole card — wrapping nests FavoriteButton's
          <button> inside an <a> (invalid HTML; breaks assistive tech and
          hydration). The heart sits above the link via z-index so it stays
          independently clickable. */}
      <div className="group relative block">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border transition-all duration-300 group-hover:ring-gold-soft/40">
          {heroPhoto ? (
            (() => {
              const src = propertyPhotoUrl(heroPhoto.storage_path);
              const blur = IMAGE_BLUR_MAP[heroPhoto.storage_path];
              // Always optimized, always lazy.
              //
              // Seed photos under /public/properties used to skip the optimizer
              // as "already 20–40 KB webps". They are up to 1600px and 390 KB
              // now, and a 230px card downloaded every byte. Cards also took
              // `priority`, which on home put a <link rel="preload"> in the head
              // for photos in rails below the hero — and for rails in the layout
              // the screen was not even showing — all racing the real LCP image.
              return (
                <Image
                  src={src}
                  alt={listing.title}
                  fill
                  sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
                  placeholder={blur ? "blur" : "empty"}
                  blurDataURL={blur}
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              );
            })()
          ) : (
            <div className="flex h-full items-center justify-center text-5xl text-foreground/15">
              🏛️
            </div>
          )}

          {/* Keeps the gold arrow chip readable over a bright photo. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

          {/* Top-leading — the category. Same pill the auction type used. */}
          {category && (
            <div className="absolute top-2.5 start-2.5">
              <span className="mazed-gold-fill inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)]">
                {category.label_fr}
              </span>
            </div>
          )}

          {/* Bottom-leading — favourite. z-20 keeps it ABOVE the stretched
              card link (z-10) so its button still receives clicks. */}
          <div className="absolute bottom-2.5 start-2.5 z-20">
            <FavoriteButton listingId={listing.id} initialSaved={saved} loggedIn={loggedIn} />
          </div>

          {/* Bottom-trailing — polished-brass arrow chip, rotates on hover. */}
          <div className="absolute bottom-2.5 end-2.5">
            <span className="mazed-gold-fill gold-rim inline-flex h-9 w-9 items-center justify-center rounded-full transition-transform group-hover:scale-110 group-hover:rotate-45">
              <ArrowUpRight className="size-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>

        {/* BODY — naked, sits on the page. No padding, no box. */}
        <div className="space-y-1 px-1 pt-3">
          <div className="flex items-start justify-between gap-2">
            {/* dir="auto" lets the title's first strong directional character
                pick the truncation side: Latin titles ellipsis at the right,
                Arabic titles at the left. */}
            <h3
              dir="auto"
              className={`line-clamp-1 flex-1 text-[15px] font-bold leading-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              {listing.title}
            </h3>
            {listing.reference && (
              <span className="mazed-tabular mt-0.5 shrink-0 font-mono text-[9px] font-bold tracking-[0.05em] text-subtle">
                {listing.reference}
              </span>
            )}
          </div>

          {/* Price row. `dir="ltr"` on the figure so "261.000 TND" is not
              reordered into "TND 261.000" inside an RTL container. */}
          <div className="flex items-center justify-between gap-2">
            {listing.price_on_request || listing.price == null ? (
              <span className="text-[13px] font-bold text-muted">Prix sur demande</span>
            ) : (
              <span
                dir="ltr"
                className="mazed-tabular gradient-gold-text inline-flex items-baseline gap-1 text-base font-extrabold"
              >
                {formatTND(Number(listing.price), locale)}
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  {t("common.tnd")}
                </span>
              </span>
            )}
            {listing.negotiable && !listing.price_on_request && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                négociable
              </span>
            )}
          </div>

          {/* The line that decides whether the card is worth opening. */}
          <div className="flex items-center gap-2.5 text-[11px] text-muted">
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0" strokeWidth={2} />
              <span className="truncate">{where}</span>
            </span>
            {Number.isFinite(area) && area > 0 && (
              <span className="mazed-tabular inline-flex shrink-0 items-center gap-1">
                <Ruler className="size-3" strokeWidth={2} />
                {area} m²
              </span>
            )}
            {Number.isFinite(rooms) && rooms > 0 && (
              <span className="mazed-tabular inline-flex shrink-0 items-center gap-1">
                <BedDouble className="size-3" strokeWidth={2} />
                S+{rooms}
              </span>
            )}
          </div>
        </div>

        {/* Stretched link — the whole card is clickable without wrapping the
            interactive heart in an <a>. z-10 sits under the heart's z-20. */}
        <Link
          href={`/annonces/${listing.id}` as "/annonces"}
          aria-label={listing.title}
          className="absolute inset-0 z-10"
        >
          <span className="sr-only">{listing.title}</span>
        </Link>
      </div>
    </div>
  );
}
