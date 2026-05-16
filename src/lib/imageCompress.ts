"use client";

const TAG = "[compress]";
function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(
    `%c${TAG} %c${ts}`,
    "color:#d4af37;font-weight:bold",
    "color:#888",
    ...args,
  );
}
function warn(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.warn(
    `%c${TAG} %c${ts}`,
    "color:#f59e0b;font-weight:bold",
    "color:#888",
    ...args,
  );
}

export type CompressFormat = "avif" | "webp" | "auto";

export interface CompressOptions {
  /** Hard cap on the longer image side, in pixels. Default 1600. */
  maxEdge?: number;
  /** Encoder quality 0-1. Interpreted in the chosen format's scale —
   *  AVIF q0.62 ≈ WebP q0.80 visually, so pass the value that matches
   *  the format you actually requested. Default 0.80 (WebP-scale). */
  quality?: number;
  /** Output format. `avif` is ~20–30 % smaller than WebP at equivalent
   *  perceptual quality and is ideal for photos. `webp` is universal
   *  and gentler on text (use it for documents / OCR-bound captures).
   *  `auto` tries AVIF first and falls back to WebP if the browser can't
   *  encode it via canvas — Firefox and older Safari don't expose AVIF
   *  to `canvas.toBlob`. Default `webp`. */
  format?: CompressFormat;
  /** When auto/avif falls back to WebP, bump the WebP quality this much
   *  so the fallback doesn't look noticeably worse than the AVIF target.
   *  AVIF needs lower numbers for the same perceptual result. Default
   *  +0.18 (so AVIF q0.62 → WebP q0.80 on fallback). */
  fallbackQualityBump?: number;
  /** Skip compression if the source file is already smaller than this
   *  many bytes. Default 120KB — re-encoding tiny images can grow them. */
  skipBelowBytes?: number;
}

/**
 * Client-side image compression. Decodes the input File on a canvas,
 * scales it down so the longer edge ≤ maxEdge (preserving aspect),
 * and re-encodes as **AVIF or WebP** (falling back to JPEG only if the
 * browser can do neither via canvas). Returns the File ready for upload.
 *
 * Format choice matters by use-case:
 *  - **photos (property listings)** → AVIF. ~20–30 % smaller than WebP
 *    at the same perceptual quality, big wins on listing-page cold
 *    loads. Use `format: "avif"` or `"auto"`.
 *  - **documents / IDs (KYC, OCR)** → WebP. AVIF's block transform is
 *    rougher on small text and admin-review legibility. Use `format:
 *    "webp"` and a higher quality (~0.86).
 *
 * A 2–5 MB HEIC/JPEG phone capture lands at:
 *  - AVIF q0.62 @ 1600px → ~120–220 KB
 *  - WebP q0.80 @ 1600px → ~180–320 KB
 *  - WebP q0.86 @ 2000px → ~280–480 KB (the document preset)
 *
 * Falls back to the original file on any failure (decode error, OOM
 * on huge images, every encoder refuses) so the upload never breaks
 * because of the compression step.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const {
    maxEdge = 1600,
    quality = 0.8,
    format = "webp",
    fallbackQualityBump = 0.18,
    skipBelowBytes = 120 * 1024,
  } = opts;

  if (!file.type.startsWith("image/")) return file;
  // Already in the smallest modern format and small enough that
  // re-encoding would almost certainly grow it. Skip.
  if (
    (file.type === "image/avif" || file.type === "image/webp") &&
    file.size < skipBelowBytes
  ) {
    log("skip — already small modern format", {
      name: file.name,
      type: file.type,
      sizeKB: Math.round(file.size / 1024),
    });
    return file;
  }

  const tStart = performance.now();
  try {
    const bitmap = await createBitmap(file);
    const { srcW, srcH } = { srcW: bitmap.width, srcH: bitmap.height };

    let dstW = srcW;
    let dstH = srcH;
    if (Math.max(srcW, srcH) > maxEdge) {
      const scale = maxEdge / Math.max(srcW, srcH);
      dstW = Math.round(srcW * scale);
      dstH = Math.round(srcH * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
    ctx.drawImage(bitmap, 0, 0, dstW, dstH);
    bitmap.close?.();

    // Encoder cascade: try the requested format(s) in order, take the
    // first one that produces a real blob. Quality is remapped on
    // fallback so a WebP fallback from an AVIF request doesn't ship
    // noticeably worse-looking pixels.
    const attempts: Array<{ mime: string; quality: number; ext: string }> = [];
    if (format === "avif" || format === "auto") {
      attempts.push({ mime: "image/avif", quality, ext: "avif" });
    }
    if (format === "webp" || format === "auto" || format === "avif") {
      // Bump quality on fallback only — if the caller explicitly asked
      // for WebP, use their value verbatim.
      const webpQuality =
        format === "webp" ? quality : Math.min(0.95, quality + fallbackQualityBump);
      attempts.push({ mime: "image/webp", quality: webpQuality, ext: "webp" });
    }
    // Last-resort JPEG for ancient canvas implementations (none we
    // actually support today, but free safety net).
    attempts.push({ mime: "image/jpeg", quality: 0.85, ext: "jpg" });

    let blob: Blob | null = null;
    let outExt = "webp";
    let outType = "image/webp";
    for (const a of attempts) {
      const candidate = await canvasToBlob(canvas, a.mime, a.quality);
      if (candidate && candidate.type === a.mime) {
        blob = candidate;
        outExt = a.ext;
        outType = a.mime;
        break;
      }
    }
    if (!blob) throw new Error("CANVAS_TO_BLOB_FAILED");

    if (blob.size >= file.size) {
      log("skip — re-encode larger than original", {
        origKB: Math.round(file.size / 1024),
        newKB: Math.round(blob.size / 1024),
        encodedAs: outType,
      });
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const out = new File([blob], `${baseName}.${outExt}`, { type: outType });
    log("compressed", {
      ms: Math.round(performance.now() - tStart),
      from: { w: srcW, h: srcH, kb: Math.round(file.size / 1024), type: file.type },
      to: { w: dstW, h: dstH, kb: Math.round(out.size / 1024), type: out.type },
      ratio: `${(file.size / out.size).toFixed(1)}x`,
    });
    return out;
  } catch (e) {
    warn("compress failed — using original", {
      name: file.name,
      error: e instanceof Error ? e.message : String(e),
    });
    return file;
  }
}

async function createBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "undefined") {
    throw new Error("CREATE_IMAGE_BITMAP_UNAVAILABLE");
  }
  return await createImageBitmap(file);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
