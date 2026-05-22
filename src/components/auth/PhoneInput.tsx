"use client";

import { DIAL_CODES } from "@/lib/tunisia";

/**
 * Two-field phone input: a country-code select on the left, a digits-
 * only number input on the right. Shared by signup and login so the
 * two flows produce the same E.164 strings — no more "is +216 in the
 * digits or in the dial code?" guessing.
 *
 * The number input strips non-digits as you type and refuses to render
 * spaces, dashes, or `+`, so the visible string is always the bare
 * local-format number. Callers compose the final E.164 via
 * normalizeE164(dialCode, number) before submit.
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
  return (
    <div className="mt-1.5 flex gap-2">
      <select
        value={dialCode}
        onChange={(e) => onDialCodeChange(e.target.value)}
        aria-label="Indicatif pays"
        className="shrink-0 rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-2.5 py-2.5 text-sm font-bold text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      >
        {DIAL_CODES.map((c) => (
          <option key={c.code} value={c.code} className="bg-batta-surface-2">
            {c.label}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={number}
        required={required}
        placeholder={placeholder}
        aria-label={ariaLabel ?? "Numéro de téléphone"}
        onChange={(e) => onNumberChange(e.target.value.replace(/\D/g, ""))}
        className="w-full min-w-0 rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </div>
  );
}
