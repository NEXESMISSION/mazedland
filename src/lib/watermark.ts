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
 * WHY A WHITE MARK, NOT THE NAVY ONE. `logo.webp` is dark navy on transparent,
 * which is correct on our own light chrome and useless over a photo: at any
 * opacity that stays polite it disappears into a ploughed field or an evening
 * shot. `logo-mark.webp` is the same wordmark with the navy thrown away and the
 * alpha kept, filled white, and it is drawn over a soft dark shadow — light
 * mark plus dark shadow is the one combination that survives both an
 * overexposed white survey plan and a dark photo.
 *
 * WHAT IT SAYS. Both halves of what a stolen photo needs to carry — the
 * business and where to find it — are already in the wordmark itself, because
 * the wordmark IS « Mazed Immo ». Mazed Auto had to grow a caption under its
 * monogram to say the same thing; here the logo does it unaided, so there is
 * nothing to add and adding it would only repeat the domain twice.
 *
 * WHY IT IS FAINT. The mark has to survive being stolen, not be the first
 * thing anybody sees. It was 45% over 38% of the width, which made the logo
 * the loudest object in a photograph the seller took of their own land. 18%
 * over 30% is enough: a watermark does not have to be read at a glance to
 * work, it has to be impossible to remove without cropping the subject, and
 * that is a property of WHERE it sits rather than how bright it is. Same
 * numbers as Mazed Auto, deliberately — the two sites are judged side by
 * side.
 *
 * WHY IT IS DRAWN, NOT COMPOSITED SERVER-SIDE. Photos go straight from the
 * browser to storage on a signed URL — the bytes never pass through our
 * server. Watermarking here is what stamps every image that reaches the
 * bucket. It follows that a determined seller with devtools could upload
 * unmarked bytes; that is not the threat. The threat is someone else lifting
 * a published photo, and for that every published photo carrying the mark is
 * exactly the property we need.
 */

/** Fraction of the image's WIDTH the mark spans. */
const MARK_WIDTH_RATIO = 0.3;
/** A floor so the mark does not vanish entirely on a tiny upload. */
const MIN_MARK_PX = 96;
/** How present the mark is. Deliberately low — see the note above. */
const MARK_OPACITY = 0.18;
/** The trimmed wordmark — white on transparent, ~3.3:1. */
const MARK_SRC = "/logo-mark.webp";

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
  let markW = Math.min(Math.max(MIN_MARK_PX, Math.round(width * MARK_WIDTH_RATIO)), width);
  let markH = Math.round(markW * aspect);
  if (markH > height) {
    markH = height;
    markW = Math.round(markH / aspect);
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
