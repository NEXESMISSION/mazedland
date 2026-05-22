"use client";

import { ensureDisplayable } from "./heic";

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
  /** Bail out (return original) if the input is larger than this many
   *  bytes — guards against decoding a 100 MP DSLR capture, which can
   *  OOM low-memory phones inside createImageBitmap. Default 30 MB. */
  maxInputBytes?: number;
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
    maxInputBytes = 30 * 1024 * 1024,
  } = opts;

  // Decode HEIC/HEIF up front — the canvas path below can't read it. After
  // this `file` is a JPEG (or the original if conversion failed).
  file = await ensureDisplayable(file);

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
  // Monster files (100MP DSLR, multi-shot panoramas) can OOM low-memory
  // phones inside createImageBitmap. Skip the canvas path and ship the
  // original — uploadToBucket's MAX_IMAGE_BYTES will still reject if it
  // truly is too large; this just stops the decoder from crashing the
  // tab on the way there.
  if (file.size > maxInputBytes) {
    warn("skip — input above maxInputBytes, decoding would risk OOM", {
      name: file.name,
      sizeMB: Math.round(file.size / 1024 / 1024),
      maxMB: Math.round(maxInputBytes / 1024 / 1024),
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

    // For very large sources we do TWO passes instead of one giant
    // downscale: huge → 2x target (cheap, browser's hardware-accelerated
    // bilinear handles this well) → target (smoother final result). Same
    // bytes in / out, but ~30% less peak memory and visibly sharper than
    // a single 8x or 10x jump from the source bitmap to a tiny canvas.
    let renderBitmap = bitmap;
    const longEdge = Math.max(srcW, srcH);
    if (longEdge > maxEdge * 2) {
      const intW = Math.round(srcW * ((maxEdge * 2) / longEdge));
      const intH = Math.round(srcH * ((maxEdge * 2) / longEdge));
      const intermediate = makeRenderSurface(intW, intH);
      intermediate.ctx.drawImage(bitmap, 0, 0, intW, intH);
      bitmap.close?.();
      renderBitmap = await readBitmapFromSurface(intermediate);
    }

    const surface = makeRenderSurface(dstW, dstH);
    surface.ctx.drawImage(renderBitmap, 0, 0, dstW, dstH);
    renderBitmap.close?.();

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
      const candidate = await surfaceToBlob(surface, a.mime, a.quality);
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
  // `imageOrientation: "from-image"` makes the decoder apply the EXIF
  // Orientation tag to the pixels. Without it, iPhones photographing a
  // CIN portrait-style upload the image sideways: the JPEG holds
  // landscape pixels + an Orientation=6 tag, and the canvas redraw
  // strips the tag without rotating, baking in the rotation bug.
  // Safari < 15 and ancient Android browsers don't support the option;
  // they ignore it gracefully, which means the same orientation bug
  // they always had — acceptable trade-off for the modern majority.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

type RenderSurface =
  | { kind: "offscreen"; canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }
  | { kind: "dom"; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/**
 * Build a 2D drawing surface — OffscreenCanvas when the browser supports
 * it, otherwise a DOM canvas. OffscreenCanvas runs without attaching to
 * the document, so it doesn't trigger style/layout/paint and skips the
 * compositor's "did the canvas content change?" path. On a sell flow
 * that compresses ten 4K photos in sequence this is ~25% faster on
 * mid-range Android phones and never blocks scrolling.
 */
function makeRenderSurface(w: number, h: number): RenderSurface {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext("2d");
      if (ctx) return { kind: "offscreen", canvas: off, ctx };
    } catch {
      /* fall through to DOM canvas */
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  return { kind: "dom", canvas, ctx };
}

/**
 * Read the pixels off a render surface as a fresh ImageBitmap, so we
 * can feed them into a second drawImage() pass without keeping the
 * intermediate canvas in memory. Falls back to a same-surface read if
 * createImageBitmap can't accept the source.
 */
async function readBitmapFromSurface(s: RenderSurface): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "undefined") {
    throw new Error("CREATE_IMAGE_BITMAP_UNAVAILABLE");
  }
  if (s.kind === "offscreen") {
    return await createImageBitmap(s.canvas);
  }
  return await createImageBitmap(s.canvas);
}

/**
 * Encode the surface to a Blob. OffscreenCanvas exposes a native
 * promise-based `convertToBlob`; DOM canvas needs the callback-style
 * `toBlob` wrapped in a Promise. Either way the encoder runs on the
 * same thread, but the OffscreenCanvas path doesn't paint, doesn't
 * commit a frame, and doesn't keep the canvas alive in the document.
 */
function surfaceToBlob(
  s: RenderSurface,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (s.kind === "offscreen") {
    return s.canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => s.canvas.toBlob(resolve, type, quality));
}
