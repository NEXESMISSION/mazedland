"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AdminButton, adminBtn, type AdminButtonVariant } from "../AdminButton";

/**
 * The dialog in front of anything that cannot be undone.
 *
 * The console has four different confirm patterns today — an inline "cliquez
 * encore pour confirmer", two `window.confirm()` calls, and one that just
 * does it — so how much friction a destructive action carries depends on
 * which screen you're on rather than on what it destroys.
 *
 * `reason` turns it into the reject flow: a required motif, captured and
 * handed back to the caller, because "Refusée" with no reason is a support
 * ticket a week later.
 */
export function Confirm({
  open,
  title,
  body,
  confirmLabel = "Confirmer",
  variant = "danger",
  pending = false,
  reason,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  variant?: AdminButtonVariant;
  pending?: boolean;
  /** Ask for a written motif. `required` blocks confirm until it's filled. */
  reason?: { label: string; placeholder?: string; required?: boolean };
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    // Focus the motif when there is one, otherwise Cancel — never the
    // destructive button, so Enter can't destroy anything by reflex.
    const id = setTimeout(() => {
      (reason ? inputRef.current : cancelRef.current)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, reason, onCancel]);

  if (!open) return null;

  const blocked = Boolean(reason?.required) && text.trim().length === 0;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} aria-hidden />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-lg)]">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--tone-bad-bg)] text-[var(--tone-bad)]">
            <AlertTriangle className="size-4.5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-extrabold leading-tight text-foreground">
              {title}
            </h2>
            {body && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>}
          </div>
        </div>

        {reason && (
          <label className="mt-4 block">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
              {reason.label}
              {reason.required && <span className="ms-1 text-[var(--tone-bad)]">*</span>}
            </span>
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={reason.placeholder}
              className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-foreground placeholder:text-subtle focus:border-gold focus:outline-none"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {/* A plain button, not <AdminButton>, because this one needs a ref:
              it is what receives focus when the dialog opens. */}
          <button ref={cancelRef} type="button" onClick={onCancel} className={adminBtn("ghost", "md")}>
            Annuler
          </button>
          <AdminButton
            variant={variant}
            size="md"
            type="button"
            pending={pending}
            disabled={blocked}
            disabledReason={blocked ? "Renseignez le motif." : undefined}
            onClick={() => onConfirm(text.trim())}
          >
            {confirmLabel}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
