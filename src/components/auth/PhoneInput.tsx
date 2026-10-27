"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Check } from "lucide-react";
import { DIAL_CODES, dialCodeLabel } from "@/lib/tunisia";
import { phoneEntry } from "@/lib/authEntry";

/**
 * Single-field phone input: dial-code chip + number input share one
 * rounded container so they read as a single control, not two
 * neighbouring boxes. The dial code chip stays compact (just the code
 * + chevron, no country name) — the country still surfaces in the
 * popover that opens on tap.
 *
 * Why a custom popover instead of native <select>:
 *   - A native <select> sizes itself to fit the SELECTED option's
 *     text. With "+216 Tunisie" as the value the closed control was
 *     wider than the number input next to it, dwarfing the field.
 *   - The popover lets us keep the closed state at "+216 ⌄" (~60 px
 *     wide) while still showing the country name in the open list.
 *   - Escape + outside-click close handlers ship with the popover so
 *     the keyboard / touch flow matches the rest of the app.
 *
 * +216 is the forms' default; the keypad is the numeric one; a number that
 * arrives whole with its code sets the chip itself.
 */
export function PhoneInput({
  dialCode,
  onDialCodeChange,
  number,
  onNumberChange,
  required,
  placeholder = "12345678",
  ariaLabel,
}: {
  dialCode: string;
  onDialCodeChange: (v: string) => void;
  number: string;
  onNumberChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const t = useTranslations("auth.phoneInput");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // On open, point the active row at the current selection.
  //
  // On the OPEN transition during render, not in an effect: the highlight is
  // right on the list's first paint instead of jumping a frame later.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      const i = DIAL_CODES.findIndex((c) => c.code === dialCode);
      setActiveIdx(i >= 0 ? i : 0);
    }
  }

  function commit(idx: number) {
    const c = DIAL_CODES[idx];
    if (c) onDialCodeChange(c.code);
    setOpen(false);
  }

  // Combobox keyboard nav: open on Down/Enter/Space, then arrows move the
  // active option (announced via aria-activedescendant) and Enter selects.
  function onTriggerKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(DIAL_CODES.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(activeIdx);
    }
  }

  const selectedEntry = DIAL_CODES.find((c) => c.code === dialCode);
  const selectedCountry = selectedEntry
    ? dialCodeLabel(selectedEntry, locale).replace(`${dialCode} `, "").trim()
    : "";

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <div className="flex items-stretch overflow-hidden rounded-xl border border-mazed-gold/25 bg-mazed-surface-2 transition focus-within:border-mazed-gold focus-within:ring-1 focus-within:ring-mazed-gold/40">
        {/* Compact dial-code chip — code + chevron, no country label */}
        <button
          type="button"
          role="combobox"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKey}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? optionId(activeIdx) : undefined}
          aria-label={t("dialCodeLabel", { country: selectedCountry || dialCode })}
          className="flex shrink-0 items-center gap-1 border-e border-mazed-gold/15 px-3 py-2.5 text-sm font-bold text-mazed-cream transition hover:bg-black/15 focus:outline-none"
        >
          <span className="mazed-tabular" dir="ltr">{dialCode}</span>
          <ChevronDown
            className={`size-3.5 opacity-70 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            strokeWidth={2.4}
          />
        </button>
        {/* Digits read left to right in both languages. Under RTL the field
            sits after the chip, so `rtl:text-end` (the right edge of this
            ltr box) keeps the number next to its dial code.

            `tel`, not `tel-national`: what the phone offers is the person's
            own number whole (« +33 6 12 34 56 78 »), and phoneEntry moves its
            code to the chip. The national form drops the code, so a number
            from abroad landed under +216. */}
        <input
          type="tel"
          dir="ltr"
          inputMode="numeric"
          autoComplete="tel"
          value={number}
          required={required}
          placeholder={placeholder}
          aria-label={ariaLabel ?? t("numberLabel")}
          onChange={(e) => {
            const ie = e.nativeEvent as InputEvent;
            // One key at a time is typing; anything else came whole — autofill,
            // a paste, a keyboard suggestion — and may carry its dial code.
            const keystroke =
              !!ie.inputType?.startsWith("delete") ||
              ((ie.inputType === "insertText" || ie.inputType === "insertCompositionText") && (ie.data ?? "").length <= 1);
            const next = phoneEntry(e.target.value, dialCode, !keystroke);
            if (next.dialCode !== dialCode) onDialCodeChange(next.dialCode);
            onNumberChange(next.number);
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-mazed-cream placeholder:text-mazed-muted focus:outline-none rtl:text-end"
        />
      </div>

      {/* Popover — dial-code list. Country names live here so users who
          don't know their code offhand still find their entry; closed
          chip stays at "+216" width regardless. */}
      {open && (
        <ul
          role="listbox"
          id={listboxId}
          aria-label={t("listLabel")}
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-mazed-gold/25 bg-mazed-surface-2 py-1 shadow-2xl shadow-black/40"
        >
          {DIAL_CODES.map((c, i) => {
            const active = c.code === dialCode;
            const isActive = i === activeIdx;
            const country = dialCodeLabel(c, locale).replace(`${c.code} `, "").trim();
            return (
              <li key={c.code}>
                <button
                  type="button"
                  role="option"
                  id={optionId(i)}
                  aria-selected={active}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    onDialCodeChange(c.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-[13px] transition ${
                    active
                      ? "bg-mazed-gold/15 text-mazed-gold"
                      : isActive
                        ? "bg-black/20 text-mazed-cream"
                        : "text-mazed-cream hover:bg-black/20"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="mazed-tabular font-bold" dir="ltr">{c.code}</span>
                    <span
                      className={`text-[11.5px] ${
                        active ? "text-mazed-gold/80" : "text-mazed-muted"
                      }`}
                    >
                      {country}
                    </span>
                  </span>
                  {active && (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.6} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
