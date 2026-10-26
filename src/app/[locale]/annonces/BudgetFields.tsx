"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { inputsInverted } from "@/lib/range";
import { BUDGET_PRESETS, budgetChipLabel } from "@/lib/budgetPresets";
import { chipClass } from "@/lib/chips";

// Full width on a phone, the field over its chips; side by side from `sm`,
// top-aligned so the two fields stay level whatever their chips wrap to.
const COLUMN = "basis-full self-start sm:flex-1 sm:basis-40";
const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";
// 16px, like the search field: iOS zooms into anything smaller.
const INPUT =
  "mazed-tabular mt-1 h-11 w-full rounded-xl border bg-surface-2 px-3 text-[16px] font-bold text-foreground outline-none transition placeholder:font-normal placeholder:text-muted focus:border-gold-soft focus:bg-surface";

/**
 * The budget's two numbers, inside the catalogue's GET form.
 *
 * A minimum above the maximum used to go through and come back as an empty
 * page. Here it blocks the submit, with the reason under the fields: the
 * browser's own check is told the field is invalid, so the form still needs
 * no handler of its own. Before hydration the form goes through, and the page
 * ignores the inverted pair and shows the same message, which is also how an
 * address that already holds one arrives.
 *
 * The message waits for a blur or a submit: typing « 1 » on the way to
 * « 100 000 » is not a mistake yet.
 *
 * Under each field, round amounts that fill it in one tap
 * (src/lib/budgetPresets.ts), on the deal's own scale; a chip that would put
 * the floor above the ceiling is not offered. Typing stays for the rest.
 */
export function BudgetFields({
  defaultMin,
  defaultMax,
  minLabel,
  maxLabel,
  maxPlaceholder,
  step,
  invertedMessage,
}: {
  defaultMin: string;
  defaultMax: string;
  minLabel: string;
  maxLabel: string;
  maxPlaceholder: string;
  step: number;
  invertedMessage: string;
}) {
  const locale = useLocale();
  // The page picks its brackets' scale from the same parameter: a rent is a
  // monthly figure, and sale amounts would put every rental under the first chip.
  const deal = useSearchParams().get("deal") === "rent" ? "rent" : "sale";
  const presets = BUDGET_PRESETS[deal];
  const [min, setMin] = useState(defaultMin);
  const [max, setMax] = useState(defaultMax);
  const [checked, setChecked] = useState(() => inputsInverted(defaultMin, defaultMax));
  const maxRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const errorId = `${ids}-error`;
  const inverted = inputsInverted(min, max);
  const showError = inverted && checked;

  useEffect(() => {
    maxRef.current?.setCustomValidity(inverted ? invertedMessage : "");
  }, [inverted, invertedMessage]);

  const border = showError ? "border-[var(--danger)]" : "border-border";

  /** One field's chips: tap to fill it, tap again to empty it. */
  const chips = (which: "min" | "max", values: readonly number[]) => {
    const current = which === "min" ? min : max;
    const put = which === "min" ? setMin : setMax;
    return (
      <div role="radiogroup" aria-labelledby={`${ids}-${which}`} className="mt-2 flex flex-wrap gap-2">
        {values.map((n) => {
          const on = Number(current) === n;
          const v = String(n);
          // Never a pair that matches nothing.
          const off = !on && (which === "min" ? inputsInverted(v, max) : inputsInverted(min, v));
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={off}
              onClick={() => {
                put(on ? "" : v);
                setChecked(true);
              }}
              className={chipClass(on)}
            >
              {budgetChipLabel(n, deal, locale)}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className={COLUMN}>
        <label className={LABEL}>
          <span id={`${ids}-min`}>{minLabel}</span>
          <input
            type="number"
            name="min"
            min={0}
            step={step}
            inputMode="numeric"
            value={min}
            onChange={(e) => {
              setMin(e.target.value);
              setChecked(false);
            }}
            onBlur={() => setChecked(true)}
            placeholder="0"
            aria-invalid={showError || undefined}
            aria-describedby={showError ? errorId : undefined}
            className={`${INPUT} ${border}`}
          />
        </label>
        {chips("min", presets.floors)}
      </div>
      <div className={COLUMN}>
        <label className={LABEL}>
          <span id={`${ids}-max`}>{maxLabel}</span>
          <input
            ref={maxRef}
            type="number"
            name="max"
            min={0}
            step={step}
            inputMode="numeric"
            value={max}
            onChange={(e) => {
              setMax(e.target.value);
              setChecked(false);
            }}
            onBlur={() => setChecked(true)}
            // Our message, not the browser's bubble: the same one in every
            // browser, and the one a reader of the page already has.
            onInvalid={(e) => {
              e.preventDefault();
              setChecked(true);
              e.currentTarget.focus();
            }}
            placeholder={maxPlaceholder}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? errorId : undefined}
            className={`${INPUT} ${border}`}
          />
        </label>
        {chips("max", presets.ceilings)}
      </div>
      {showError && (
        <p id={errorId} role="alert" className="basis-full text-[12px] font-semibold text-[var(--danger)]">
          {invertedMessage}
        </p>
      )}
    </>
  );
}
