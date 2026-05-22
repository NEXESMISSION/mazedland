"use client";

/**
 * iPhone photos are HEIC/HEIF by default. Chrome/Firefox (and the canvas
 * `createImageBitmap` path our compressor uses) can't decode HEIC, so an
 * uploaded HEIC ends up stored as-is and renders as a broken image
 * everywhere. This converts HEIC/HEIF to a JPEG File in the browser so the
 * downstream preview + compression + upload all work.
 *
 * heic2any (libheif wasm, ~1.5 MB) is dynamically imported so it only
 * loads when a HEIC file is actually picked — it stays out of the main
 * bundle for everyone else.
 */

import { log } from "@/lib/log";

const xlog = log.scope("img");

export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  // Mobile pickers often hand us an empty MIME type — fall back to ext.
  return /\.(heic|heif)$/i.test(file.name);
}

export async function ensureDisplayable(file: File): Promise<File> {
  const heic = isHeic(file);
  xlog.debug("ensureDisplayable", {
    name: file.name,
    type: file.type || "(empty)",
    sizeKB: Math.round(file.size / 1024),
    heic,
  });
  if (!heic) return file;
  const done = xlog.time(`heic convert ${file.name}`);
  try {
    const heic2any = (await import("heic2any")).default;
    // Race against a timeout: heic2any spins up a Web Worker, and if that
    // worker is blocked (e.g. a strict CSP) the promise can hang forever
    // instead of rejecting — which would freeze the upload button. The
    // timeout guarantees we always fall back to the original file.
    const out = await withTimeout(
      heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 }),
      20_000,
    );
    const blob = Array.isArray(out) ? out[0] : out;
    const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
    done();
    xlog.info("heic converted ok", { name, outKB: Math.round(blob.size / 1024) });
    return new File([blob], name, { type: "image/jpeg" });
  } catch (e) {
    done();
    // Conversion failed or timed out — return the original so the upload
    // still happens; worst case it stays a broken thumbnail rather than
    // blocking the flow. We LOUDLY log it so a broken preview is traceable.
    xlog.error("heic conversion failed — using original (preview may break)", {
      name: file.name,
      reason: e instanceof Error ? e.message : String(e),
    });
    return file;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("heic_timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
