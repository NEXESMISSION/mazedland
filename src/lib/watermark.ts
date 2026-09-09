"use client";

/**
 * Stamp the Mazed Immo wordmark into the middle of a listing photo.
 *
 * WHY THE MIDDLE. A corner watermark is removed with one crop, and on a
 * classifieds site the photos ARE the product — a terrain photo or a survey
 * plan gets lifted and reposted on Facebook groups and rival boards within
 * hours. Centred, the only way to remove it is to crop away the subject, which
 * is exactly the trade we want to force.
 *
 * WHY A WHITE MARK, NOT THE GOLD ONE. `logo.webp` is metallic gold on
 * transparent, which is correct on our own white chrome and useless over a
 * photo: at any opacity that stays polite the gold disappears into a ploughed
 * field or an evening shot, and the two ends of its own ramp fight each other.
 * `logo-watermark.webp` is the same lockup with the gold thrown away and the
 * alpha kept, flooded white, and it is drawn over a soft dark shadow — light
 * mark plus dark shadow is the one combination that survives both an
 * overexposed white survey plan and a dark photo.
 *
 * WHAT IT SAYS. Both halves of what a stolen photo needs to carry — the
 * business and where to find it — are in the lockup itself: the tower reads as
 * a mark and MAZED sits under it in type. The stamp is the whole lockup rather
 * than the tower alone for exactly that reason; a bare monogram on a stolen
 * photo says nothing to anyone who has not already learnt it.
 *
 * WHY IT IS FAINT. The mark has to survive being stolen, not be the first
 * thing anybody sees. A watermark does not have to be read at a glance to
 * work; it has to be impossible to remove without cropping the subject, and
 * that is a property of WHERE it sits rather than how loud it is.
 *
 * 15% opacity over 22% of the HEIGHT. Mazed Auto uses 18% over 30% of the
 * width, and neither number ports directly: its mark is a wide monogram and
 * this one is a portrait lockup, so matching Auto span-for-span would put
 * three times as much ink on the photo. The SPAN is matched on area instead
 * — about 2% of the frame on both sites. The OPACITY is lower than Auto's
 * because a solid tower is a denser shape than a monogram at the same alpha:
 * it has no interior counters for the photograph to show through, so the same
 * 18% that reads as a faint mark over a car reads as a smudge over a field.
 *
 * WHY IT IS DRAWN, NOT COMPOSITED SERVER-SIDE. Photos go straight from the
 * browser to storage on a signed URL — the bytes never pass through our
 * server. Watermarking here is what stamps every image that reaches the
 * bucket. It follows that a determined seller with devtools could upload
 * unmarked bytes; that is not the threat. The threat is someone else lifting
 * a published photo, and for that every published photo carrying the mark is
 * exactly the property we need.
 */

/**
 * Fraction of the image's HEIGHT the mark spans.
 *
 * It used to be a fraction of the WIDTH, which was right while the mark was a
 * 3.3:1 wordmark and is wrong now that it is a portrait lockup: 30% of the
 * width of a landscape photo makes a stamp 40% of its height, and the clamp
 * below would then shrink it back on anything squarer. Driving off the height
 * gives the same visual weight on a landscape photo, a portrait one and a
 * square thumbnail without the clamp ever firing.
 */
const MARK_HEIGHT_RATIO = 0.22;
/** Never wider than this fraction of the image, for very tall crops. */
const MAX_MARK_WIDTH_RATIO = 0.32;
/** A floor so the mark does not vanish entirely on a tiny upload. */
const MIN_MARK_PX = 96;
/** How present the mark is. Deliberately low — see the note above. */
const MARK_OPACITY = 0.15;
/** The trimmed lockup — white on transparent, ~0.74:1 (portrait). */
const MARK_SRC = "/logo-watermark.webp";

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

/**
 * Draw the mark centred on an already-rendered 2D context.
 *
 * Exported separately so a caller that already has a canvas (a future
 * server-side or worker path) can stamp without a second decode.
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  mark: HTMLImageElement,
  width: number,
  height: number,
): void {
  const aspect = mark.naturalHeight / mark.naturalWidth;

  // Fit, then centre. `MIN_MARK_PX` is a floor on legibility, not a promise
  // that the photo is big enough to hold it: the catalogue contains a 120x120
  // thumbnail, and asking for a 160px mark on it drew a stamp wider than the
  // image. The canvas does not complain — it just crops the mark and produces
  // a photo branded with a fragment of a logo.
  let markH = Math.min(Math.max(MIN_MARK_PX, Math.round(height * MARK_HEIGHT_RATIO)), height);
  let markW = Math.round(markH / aspect);
  const maxW = Math.round(width * MAX_MARK_WIDTH_RATIO);
  if (markW > maxW) {
    markW = maxW;
    markH = Math.round(markW * aspect);
  }
  const x = Math.round((width - markW) / 2);
  const y = Math.round((height - markH) / 2);

  ctx.save();
  ctx.globalAlpha = MARK_OPACITY;

  // The shadow is what keeps a white mark legible on a white background — and
  // most of what sellers upload here is a photographed survey plan or an
  // overexposed midday field.
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = Math.max(6, Math.round(markW * 0.035));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, Math.round(markW * 0.006));

  ctx.drawImage(mark, x, y, markW, markH);
  ctx.restore();
}

/**
 * Return a copy of `file` with the wordmark stamped in the middle.
 *
 * Returns the ORIGINAL file if anything goes wrong — a missing logo, a
 * browser that will not encode, a decode failure. A photo without a watermark
 * is worth far more to the seller than a failed upload, so this never throws
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
