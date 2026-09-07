"use client";

import { useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

/**
 * One uploaded payment receipt, rendered so the admin can ALWAYS get to the
 * proof — never a broken image box.
 *
 * Receipts arrive as whatever the buyer's phone produced. Three cases the
 * review surfaces used to get wrong:
 *   - PDF        → an <img src="…pdf"> paints nothing. Needs a link.
 *   - HEIC/HEIF  → iPhone default. Chrome and Firefox cannot decode it, so a
 *                  conversion that failed client-side (or any receipt uploaded
 *                  before the compressor stamped a real mimetype) shows an
 *                  empty frame with no way to read it.
 *   - anything   → a signed URL can expire, or the object can be missing.
 *                  `onError` degrades to the same link instead of a blank.
 *
 * The link opens the signed URL directly, which downloads/renders in the
 * browser's own viewer — enough to validate a payment.
 */

/** Extensions a browser paints inline in an <img>. */
const INLINE_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]);

function extOf(path: string): string {
  return path.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
}

export function ReceiptPreview({
  url,
  path,
  triggerClassName = "relative block aspect-video w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:ring-2 hover:ring-[var(--gold-soft)]",
  imgClassName = "h-full w-full object-contain",
  label = "Reçu",
}: {
  /** Signed URL for the object. */
  url: string;
  /** Storage path — the reliable source of the file's real extension. */
  path: string;
  triggerClassName?: string;
  imgClassName?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ext = extOf(path) || extOf(url);
  const renderable = INLINE_IMAGE_EXT.has(ext);

  if (!renderable || failed) {
    const what =
      ext === "pdf"
        ? "PDF"
        : ext === "heic" || ext === "heif"
          ? "HEIC"
          : failed
            ? "non affichable"
            : ext.toUpperCase() || "fichier";
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-2.5 text-[13px] font-semibold hover:border-[var(--gold-soft)]"
      >
        <FileText className="h-4 w-4 text-[var(--gold)]" />
        Ouvrir le {label.toLowerCase()} ({what})
        <ExternalLink className="h-3 w-3 text-[var(--foreground-muted)]" />
      </a>
    );
  }

  return (
    <ImageLightbox src={url} alt={label} triggerClassName={triggerClassName}>
      {/* Plain <img>: the URL is a short-lived signed link, so routing it
          through the image optimizer buys nothing and adds a failure mode. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        className={imgClassName}
        onError={() => setFailed(true)}
      />
    </ImageLightbox>
  );
}
