"use client";

/**
 * Stamp the Mazed gold logo, small, in the top-right corner of a listing photo.
 *
 * WHY THE CORNER. The mark used to sit in the middle, faint and white, so
 * that nobody could crop it away without cropping the house. The owners chose
 * the other trade (2026-10-24): the photos are the product, a white smudge
 * across the middle of every one made them look worse, and the logo is there
 * to sign the photo — this is a Mazed annonce — not to fight people who lift
 * it. A signature goes in a corner, small and clean.
 *
 * WHY THE GOLD LOGO. It is the brand everyone knows from the Facebook page
 * and the site. At a corner size it is solid enough to read over a sky or a
 * field; the soft dark shadow under it is what keeps it legible over a white
 * survey plan or an overexposed wall.
 *
 * HOW BIG. 13% of the photo's height, never more than 16% of its width: on a
 * 1600 × 1200 photo that is a lockup about 115 × 155 px, a signature rather
 * than a stamp.
 *
 * WHERE EXACTLY. 4% of the height from the top, 8% of the width from the
 * right. Most photos are 3:2 and the listing page and the cards show them in
 * a 4:3 frame, which crops about 5.6% off each side: at 8% the logo survives
 * that crop whole instead of being cut in half at the edge.
 *
 * WHY IT IS DRAWN, NOT COMPOSITED SERVER-SIDE. Photos go straight from the
 * browser to storage on a signed URL — the bytes never pass through our
 * server. Stamping here is what marks every image that reaches the bucket.
 *
 * The catalogue photos already published are stamped by
 * scripts/watermark-existing-photos.mjs with the same numbers: keep the two
 * in step.
 */

/** Fraction of the image's HEIGHT the logo spans (it is a portrait lockup). */
const MARK_HEIGHT_RATIO = 0.13;
/** Never wider than this fraction of the image, for very tall crops. */
const MAX_MARK_WIDTH_RATIO = 0.16;
/** A floor so the logo stays readable on a small upload. */
const MIN_MARK_PX = 48;
/** Gap to the top edge, as a fraction of the height. */
const MARGIN_TOP_RATIO = 0.04;
/** Gap to the right edge, as a fraction of the width — clears a 4:3 crop of a 3:2 photo. */
const MARGIN_RIGHT_RATIO = 0.08;
/** Nearly solid: a small signature has to be seen. */
const MARK_OPACITY = 0.92;
/**
 * The gold lockup (tower + MAZED), 357 × 480: logo.png with its faint alpha
 * haze (alpha under 24) cleared, which otherwise tints the whole rectangle
 * around the logo and shows as a box on a smooth wall or sky.
 */
const MARK_SRC = "/logo-stamp.webp";

/**
 * The decoded mark, fetched once per page rather than per photo.
 *
 * A seller uploads eight photos at a time; without this the same file is
 * fetched and decoded eight times while the phone is already busy re-encoding
 * images.
 */
let markPromise: Promise<HTMLImageElement | null> | null = null;

function loadMark(): Promise<HTMLImageElement | null> {
  if (markPromise) return markPromise;
  markPromise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    // Same-origin, but decoding into a canvas we later export means the
    // canvas must not be tainted.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = MARK_SRC;
  });
  return markPromise;
}

/** Where the logo goes and how big, for a photo of this size. Pure. */
export function markBox(
  width: number,
  height: number,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  // `MIN_MARK_PX` is a floor on legibility, not a promise that the photo is
  // big enough to hold it: the catalogue contains a 120x120 thumbnail.
  let h = Math.min(Math.max(MIN_MARK_PX, Math.round(height * MARK_HEIGHT_RATIO)), Math.round(height * 0.5));
  let w = Math.round(h / aspect);
  const maxW = Math.round(width * MAX_MARK_WIDTH_RATIO);
  if (w > maxW) {
    w = maxW;
    h = Math.round(w * aspect);
  }
  return { x: width - w - Math.round(width * MARGIN_RIGHT_RATIO), y: Math.round(height * MARGIN_TOP_RATIO), w, h };
}

/**
 * Draw the logo in the top-right corner of an already-rendered 2D context.
 *
 * Exported separately so a caller that already has a canvas can stamp
 * without a second decode.
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  mark: HTMLImageElement,
  width: number,
  height: number,
): void {
  const { x, y, w, h } = markBox(width, height, mark.naturalHeight / mark.naturalWidth);

  ctx.save();
  ctx.globalAlpha = MARK_OPACITY;
  // A soft shadow lifts the gold off a white wall or a bright sky.
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = Math.max(4, Math.round(w * 0.06));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, Math.round(w * 0.015));
  ctx.drawImage(mark, x, y, w, h);
  ctx.restore();
}

/**
 * Return a copy of `file` with the logo stamped in the top-right corner.
 *
 * Returns the ORIGINAL file if anything goes wrong — a missing logo, a
 * browser that will not encode, a decode failure. A photo without a logo is
 * worth far more to the seller than a failed upload, so this never throws
 * and never blocks.
 */
export async function watermarkImage(file: File): Promise<File> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return file;

  try {
    const [mark, bitmap] = await Promise.all([loadMark(), createImageBitmap(file)]);
    if (!mark) return file;

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    drawWatermark(ctx, mark, canvas.width, canvas.height);

    // Re-encode as WebP at a high quality. The input has already been through
    // `compressImage`, so this pass is about preserving what is there rather
    // than squeezing further — encoding a second time at the same quality is
    // what turns a clean photo into a smeared one.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.92),
    );
    if (!blob) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return file;
  }
}
