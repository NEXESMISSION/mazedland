"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** When true (default), renders as a bottom-sheet on mobile. */
  mobileSheet?: boolean;
  /** Hide the close (X) button — for forced-decision flows. */
  hideClose?: boolean;
}

const sizeMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

/**
 * Lightweight portal-mounted dialog. Mobile becomes a bottom sheet,
 * desktop is a centered card. Escape closes; backdrop click closes;
 * Tab is trapped inside the dialog so keyboard nav doesn't escape into
 * the page behind.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  mobileSheet = true,
  hideClose = false,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const moveFocus = () => {
      const node = dialogRef.current;
      if (!node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (focusable[0] ?? node).focus();
    };
    const tId = window.setTimeout(moveFocus, 0);

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(tId);
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) {
        prev.focus();
      }
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-lg)] overflow-hidden focus:outline-none",
          mobileSheet
            ? "rounded-t-[var(--radius-xl)] md:rounded-[var(--radius-md)]"
            : "rounded-[var(--radius-md)] mx-4",
          sizeMap[size],
          "max-h-[92vh] flex flex-col",
        )}
      >
        {mobileSheet && (
          <div className="md:hidden flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
          </div>
        )}
        {(title || description || !hideClose) && (
          <div className="px-5 pt-4 pb-3 border-b border-[var(--border)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {title && (
                  <h3 className="font-bold text-lg leading-tight">{title}</h3>
                )}
                {description && (
                  <p className="text-sm text-[var(--foreground-muted)] mt-1">
                    {description}
                  </p>
                )}
              </div>
              {!hideClose && (
                <button
                  onClick={onClose}
                  className="shrink-0 h-8 w-8 -mt-1 rounded-full hover:bg-[var(--surface-2)] transition-colors flex items-center justify-center"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-5 py-4 border-t border-[var(--border)] bg-[var(--surface-2)] flex flex-col-reverse sm:flex-row gap-2 sm:justify-end",
        "pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
