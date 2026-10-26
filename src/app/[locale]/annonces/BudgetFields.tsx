"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inputsInverted } from "@/lib/range";

const LABEL = "flex-1 basis-28 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";
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
  const [min, setMin] = useState(defaultMin);
  const [max, setMax] = useState(defaultMax);
  const [checked, setChecked] = useState(() => inputsInverted(defaultMin, defaultMax));
  const maxRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const inverted = inputsInverted(min, max);
  const showError = inverted && checked;

  useEffect(() => {
    maxRef.current?.setCustomValidity(inverted ? invertedMessage : "");
  }, [inverted, invertedMessage]);

  const border = showError ? "border-[var(--danger)]" : "border-border";

  return (
    <>
      <label className={LABEL}>
        {minLabel}
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
      <label className={LABEL}>
        {maxLabel}
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
      {showError && (
        <p id={errorId} role="alert" className="basis-full text-[12px] font-semibold text-[var(--danger)]">
          {invertedMessage}
        </p>
      )}
    </>
  );
}
