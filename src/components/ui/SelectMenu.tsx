"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };

/**
 * Clean custom dropdown — replaces bare native <select>s that rendered with
 * no chevron and the raw OS picker. A styled trigger (icon + label + chevron)
 * opens a floating panel of options with a gold-checked selection, hover
 * states, click-outside + Escape to close, and arrow-key navigation. Used by
 * the home search and the Explore filter sheet so every picker on the
 * browse surfaces looks like one considered control.
 *
 * Controlled: pass `value` + `onChange`. `triggerClassName` lets each caller
 * match its surrounding chrome (inline bar, soft pill, bordered field).
 */
export function SelectMenu({
  value,
  onChange,
  options,
  placeholder,
  icon,
  ariaLabel,
  align = "start",
  triggerClassName = "",
  menuClassName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  /** Which edge the panel aligns to. */
  align?: "start" | "end";
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? "";
  const isPlaceholder = !selected || selected.value === "";
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // When opening, point the active row at the current selection.
  useEffect(() => {
    if (!open) return;
    const i = options.findIndex((o) => o.value === value);
    setActiveIdx(i >= 0 ? i : 0);
  }, [open, options, value]);

  function commit(idx: number) {
    const opt = options[idx];
    if (opt) onChange(opt.value);
    setOpen(false);
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(activeIdx);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(activeIdx) : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className={
          triggerClassName ||
          "inline-flex items-center gap-2 rounded-xl bg-transparent px-3 py-2.5 text-[13px] font-bold text-foreground transition focus:outline-none"
        }
      >
        {icon}
        <span className={`flex-1 truncate text-start ${isPlaceholder ? "text-muted" : "text-foreground"}`}>
          {label}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          strokeWidth={2.2}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          id={listboxId}
          tabIndex={-1}
          className={
            "absolute z-50 mt-2 max-h-72 min-w-[12rem] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-1.5 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.35)] ring-1 ring-black/[0.04] animate-[batta-float-up_140ms_ease-out_both] " +
            (align === "end" ? "end-0 " : "start-0 ") +
            menuClassName
          }
        >
          {options.map((o, i) => {
            const isSel = o.value === value;
            const isActive = i === activeIdx;
            return (
              <button
                key={o.value || "__all__"}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => commit(i)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-start text-[13px] font-semibold transition-colors ${
                  isSel
                    ? "bg-[var(--gold-faint)] text-[var(--gold)]"
                    : isActive
                      ? "bg-surface-2 text-foreground"
                      : "text-foreground"
                }`}
              >
                <span className="truncate">{o.label}</span>
                {isSel && <Check className="size-4 shrink-0 text-[var(--gold)]" strokeWidth={2.6} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
