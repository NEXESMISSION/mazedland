"use client";

import { useEffect } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import type { Popup } from "@/lib/popups/schema";
import { pickLocalised } from "@/lib/popups/schema";

/**
 * Centered modal popup renderer. The PopupManager owns the open/close
 * state and the impression/dismiss/click eventing; this component is
 * pure presentation.
 *
 * Layout:
 *   - Backdrop (focus trap via ESC key)
 *   - Card with optional 16:9 hero image
 *   - Icon label, title (bold), body (text-foreground/80)
 *   - 1 or 2 stacked CTAs at the bottom
 *
 * If the popup is `force_action: true`, the backdrop swallows clicks
 * and the X close button is hidden — the user must follow the primary
 * CTA to dismiss (used for legal/ToS modals).
 */
export function ModalPopup({
  popup,
  locale,
  onDismiss,
  onClick,
}: {
  popup: Popup;
  locale: string;
  onDismiss: () => void;
  onClick: (href: string) => void;
}) {
  const title = pickLocalised(popup.title, locale);
  const body = pickLocalised(popup.body, locale);
  const primary = popup.cta_primary
    ? { label: pickLocalised(popup.cta_primary.label, locale), href: popup.cta_primary.href }
    : null;
  const secondary = popup.cta_secondary
    ? { label: pickLocalised(popup.cta_secondary.label, locale), href: popup.cta_secondary.href }
    : null;
  const canDismiss = popup.dismissible && !popup.force_action;

  // ESC closes when dismissible. Force-action popups deliberately swallow
  // ESC so a legal modal can't be ducked.
  useEffect(() => {
    if (!canDismiss) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDismiss, onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`popup-${popup.id}-title`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={(e) => {
        // Click on the backdrop (not the card) dismisses, unless forced.
        if (canDismiss && e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-surface ring-1 ring-gold/30 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        {canDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fermer"
            className="absolute end-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            <X className="size-4" strokeWidth={2.5} />
          </button>
        )}
        {popup.image_url && (
          <div className="relative aspect-[16/9] w-full bg-surface-2">
            <Image
              src={popup.image_url}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 384px"
              unoptimized
              className="object-cover"
            />
          </div>
        )}
        <div className="p-6 text-center">
          {popup.icon && (
            <div className="mb-3 inline-block rounded-full bg-gold-faint px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-gold-bright">
              {popup.icon}
            </div>
          )}
          <h3
            id={`popup-${popup.id}-title`}
            className="text-[19px] font-extrabold leading-tight text-foreground"
          >
            {title}
          </h3>
          {body && (
            <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/85">
              {body}
            </p>
          )}

          {(primary || secondary) && (
            <div className="mt-5 flex flex-col gap-2">
              {primary && (
                <button
                  type="button"
                  onClick={() => onClick(primary.href)}
                  className="batta-btn-luxe tap-target inline-flex w-full items-center justify-center gap-1.5 px-4 py-3 text-[13px]"
                >
                  {primary.label}
                </button>
              )}
              {secondary && (
                <button
                  type="button"
                  onClick={() => onClick(secondary.href)}
                  className="inline-flex w-full items-center justify-center rounded-full bg-surface-2 px-4 py-2.5 text-[12.5px] font-bold text-muted ring-1 ring-border transition hover:text-foreground"
                >
                  {secondary.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
