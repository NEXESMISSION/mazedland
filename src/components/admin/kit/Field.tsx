"use client";

import { useId } from "react";

/**
 * Form primitives for the console.
 *
 * Six screens currently build their own inputs — the settings form, the
 * pricing manager, the legal-doc editor, the popup form, the manual listing
 * form and the broadcast composer — at four different heights, three border
 * treatments, and with labels that are sometimes `<label>` and sometimes a
 * `<span>` floating above an unassociated input. These are the same field,
 * once, with the label actually bound to its control.
 *
 * Everything here is controlled: the console's forms are small, and a
 * controlled field is the one that can be validated before it is submitted.
 */

const BASE =
  "w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-foreground placeholder:text-subtle transition focus:border-gold focus:outline-none disabled:opacity-50";
const H = "h-9";

function Shell({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle"
      >
        {label}
        {required && <span className="ms-1 text-[var(--tone-bad)]">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-[11.5px] font-semibold text-[var(--tone-bad)]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type Common = {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
};

export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  ...rest
}: Common & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "tel" | "email" | "url";
}) {
  const id = useId();
  return (
    <Shell id={id} {...rest}>
      <input
        id={id}
        type={type}
        value={value}
        disabled={rest.disabled}
        required={rest.required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${BASE} ${H}`}
      />
    </Shell>
  );
}

export function TextareaField({
  value,
  onChange,
  rows = 4,
  placeholder,
  ...rest
}: Common & {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Shell id={id} {...rest}>
      <textarea
        id={id}
        value={value}
        rows={rows}
        disabled={rest.disabled}
        required={rest.required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${BASE} resize-y py-2`}
      />
    </Shell>
  );
}

/**
 * A number field that reports an empty box as `null`, not `0`.
 *
 * This distinction is the whole reason it exists: `src/lib/products.ts`
 * already carries a test for it — "no price configured" must resolve to null,
 * never to free — and a field that coerces "" to 0 is how a paid product
 * silently becomes free.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  ...rest
}: Common & {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** e.g. "TND", "jours" — rendered inside the field's trailing edge. */
  suffix?: string;
}) {
  const id = useId();
  return (
    <Shell id={id} {...rest}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          disabled={rest.disabled}
          required={rest.required}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          className={`batta-tabular ${BASE} ${H} ${suffix ? "pe-14" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11.5px] font-semibold text-muted">
            {suffix}
          </span>
        )}
      </div>
    </Shell>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  ...rest
}: Common & {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <Shell id={id} {...rest}>
      <select
        id={id}
        value={value}
        disabled={rest.disabled}
        required={rest.required}
        onChange={(e) => onChange(e.target.value)}
        className={`${BASE} ${H} pe-8`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/**
 * A switch, not a checkbox — an admin toggling "actif" is changing state
 * immediately in most of these forms, and a checkbox reads as "will apply
 * when you submit".
 */
export function ToggleField({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition disabled:opacity-50 ${
          checked ? "bg-[var(--gold)]" : "bg-surface-3 ring-1 ring-border"
        }`}
      >
        <span
          className={`size-4 rounded-full bg-white shadow-sm transition ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <label htmlFor={id} className="min-w-0 cursor-pointer select-none">
        <span className="block text-[13px] font-semibold text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] text-muted">{hint}</span>}
      </label>
    </div>
  );
}

/** Lays fields out two-up on desktop, stacked on a phone. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
