"use client";

import { compressImage } from "./imageCompress";

/**
 * Turn any picked image into a small, modern-format (AVIF/WebP) File ready
 * for upload.
 *
 * Pipeline is fully client-side:
 *   - HEIC/HEIF (iPhone): heic2any decodes inside compressImage → canvas
 *     re-encodes to AVIF/WebP.
 *   - Everything else: drawn to a canvas, downscaled, re-encoded.
 *
 * Why no server roundtrip? sharp's prebuilt libvips ships without libheif
 * (LGPL-incompatible licensing), so a `/api/optimize-image` HEIC POST throws
 * "unsupported image format" → 422 → preview stays a broken iPhone HEIC.
 * Pushing the conversion to the device makes HEIC actually work, in dev
 * (Windows) and prod (Linux serverless) alike.
 *
 * Never throws: any failure returns the original file so the upload still
 * proceeds rather than blocking the whole flow.
 *
 * Presets the call sites use:
 *   - Listing photos → defaults (AVIF-first, q≈0.72, 1600px). ~120–220 KB
 *     for a 3 MB iPhone capture; ~25 % smaller than WebP at the same look.
 *   - Document scans (titre foncier etc.) → `{ format: "webp", quality: 86,
 *     maxEdge: 2000 }`. WebP's deblocking is gentler on small text, and
 *     2000px keeps stamps + serial numbers legible for admin review.
 */
export async function optimizeImage(
  file: File,
  opts: {
    maxEdge?: number;
    /** 1..100 scale (kept for legacy call sites). */
    quality?: number;
    /** Output format. `auto` tries AVIF first, falls back to WebP. */
    format?: "avif" | "webp" | "auto";
  } = {},
): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 72; // 1..100, slightly more aggressive default
  const format = opts.format ?? "auto";
  return compressImage(file, {
    maxEdge,
    quality: quality / 100,
    format,
  });
}
