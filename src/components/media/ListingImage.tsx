import { SafeImage } from "@/components/media/SafeImage";
import { propertyPhotoUrl } from "@/lib/imageUrl";

/**
 * A listing photo: whole, sharp, and served at the size it is displayed.
 *
 * Three problems, one component.
 *
 * SIZE. The v3 surfaces were built with raw `<img src={propertyPhotoUrl(...)}>`,
 * which sends the browser straight to Supabase for the original file. Measured
 * on the catalog: 1280px images decoded into 166px boxes, ~79KB each, ~2MB for
 * one screen of cards. next/image resizes to the requested width and negotiates
 * AVIF, taking the same photo to ~3KB. `sizes` is what decides which variant is
 * generated, so every caller passes the width it really occupies.
 *
 * CROPPING. Sellers shoot cars both ways. A portrait phone photo cropped to
 * fill a 4/3 card loses the roof and the wheels, and the buyer never learns
 * what they did not see — the wrong trade for a photo of the thing being sold.
 * So the photo is CONTAINED: all of it, always.
 *
 * THE GAPS. Containing on flat black turns a card into a black slab with a
 * small picture floating in it. The leftover space is filled with a soft
 * radial gradient, so the letterbox reads as part of the card.
 *
 * It used to be filled with a blurred, over-scaled SECOND COPY of the photo.
 * That looked better and cost double: two requests and — the expensive half —
 * two COLD optimizer transforms per displayed photo, since every distinct
 * (url, width, quality) is its own transform with its own origin fetch, and a
 * cold transform measures 420–730ms here. It also put a third quality value
 * into circulation (q=50 beside q=72 and q=75), so the same picture never
 * shared a cache entry with itself. On one home page it was 715 of 2 732 image
 * URLs. A gradient costs no request, no transform and no bytes.
 *
 * **The parent must be positioned** — `relative`, `absolute` or `fixed`.
 * Every layer here is `<Image fill>`, which is `position:absolute; inset:0`,
 * so without a positioned ancestor the photo resolves against the initial
 * containing block and covers the whole page instead of its box. It fails
 * silently: no error, no warning, just one listing thumbnail rendered at
 * viewport size on top of everything else. That is exactly what happened on
 * /account/listings and /account/favoris, where the wrapper was
 * `size-[74px] shrink-0 overflow-hidden …` with no `relative`.
 */

export function ListingImage({
  path,
  alt,
  sizes,
  priority = false,
  className = "",
  quality = 72,
  fit = "contain",
}: {
  /** `storage_path` from listing_photos — absolute URL or bucket-relative. */
  path: string;
  alt: string;
  /** The CSS width this image occupies, e.g. "(min-width:1024px) 25vw, 50vw". */
  sizes: string;
  /**
   * Only for what is above the fold: loads eagerly at high fetch priority.
   * Not next/image's `preload` — the <img> is already in the HTML, which is
   * the head start a preload link would buy, without one <link> per card.
   */
  priority?: boolean;
  className?: string;
  quality?: number;
  /**
   * "contain" (default) shows the whole photo over a blurred fill.
   * "cover" fills the frame and crops — for decoration only (the hero's own
   * blurred backdrop), never for a photo someone is trying to look at.
   */
  fit?: "contain" | "cover";
}) {
  const src = propertyPhotoUrl(path);

  if (fit === "cover") {
    return (
      <SafeImage
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        className={`object-cover${className ? ` ${className}` : ""}`}
        draggable={false}
      />
    );
  }

  return (
    <>
      {/* The gap filler used to be a SECOND copy of the photo — fetched again
          at 64px and q=50, blurred, cropped to cover. It looked good and it
          cost double everywhere it was used:

            · two HTTP requests per displayed photo;
            · two COLD optimizer transforms per photo, and a cold transform is
              the slow part of this pipeline (measured 420–730ms, and 504s
              under concurrency), because each distinct (url, width, quality)
              is its own transform with its own origin fetch;
            · a third quality value in circulation — the home page asked for
              q=72, q=50 and q=75 of the same pictures, so nothing shared a
              cache entry with anything else.

          On one home page that was 715 of 2 732 image URLs, every one of them
          decoration behind a photo that was already loading.

          It is a gradient now: no request, no transform, no bytes. The letter-
          box sides stay dark rather than smeared with the picture's colours —
          which is what was originally asked for ("add black sides"). */}
      {/* Token-driven, not hardcoded greys: Mazed Auto is near-black and Mazed
          Land is white, and this same component serves both. The letterbox
          should read as part of the card on either. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_40%,var(--surface-2)_0%,var(--surface-3,var(--surface-2))_60%,var(--border)_100%)]"
      />
      <SafeImage
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        className={`object-contain${className ? ` ${className}` : ""}`}
        draggable={false}
      />
    </>
  );
}
