"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Download, FileText } from "lucide-react";

/**
 * Full-screen viewer for property documents (titre foncier, permis, etc.).
 * Embeds /api/property/document/[id] in an iframe, which follows a 302
 * redirect to a short-lived Supabase signed URL. The browser renders
 * PDFs and images natively inside the frame — same UX as Drive's
 * built-in preview, no new tabs, no external apps.
 *
 * The download button uses the same endpoint with `download` attribute
 * so users can still grab the file if they want it locally.
 *
 * Escape closes; clicking outside is intentionally NOT a close target
 * (the iframe owns the whole surface and clicks inside it shouldn't
 * dismiss). The X button + Escape are the close affordances.
 */
export function DocumentViewerModal({
  open,
  onClose,
  docId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  title: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const src = `/api/property/document/${docId}`;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
    >
      <header className="flex items-center gap-2 border-b border-white/10 bg-black/85 px-3 py-2 backdrop-blur">
        <FileText className="size-4 shrink-0 text-white/70" strokeWidth={2.2} />
        <div className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-white">
          {title}
        </div>
        <a
          href={src}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 active:scale-95"
          aria-label="Télécharger le document"
          title="Télécharger"
        >
          <Download className="size-4" strokeWidth={2.2} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/10 active:scale-95"
          aria-label="Fermer"
          autoFocus
        >
          <X className="size-5" strokeWidth={2.4} />
        </button>
      </header>
      <iframe
        src={src}
        title={title}
        className="w-full flex-1 border-0 bg-white"
      />
    </div>,
    document.body,
  );
}
