"use client";

import { useEffect, useRef } from "react";
import { OTP_LENGTH, otpEntry } from "@/lib/authEntry";

/**
 * The SMS code, in one field — the signup's and the password recovery's.
 *
 * It takes the code however it comes: typed, offered by the phone from the
 * SMS (`autocomplete="one-time-code"`), or pasted with the message around
 * it. A `maxLength` of six cut a pasted « Votre code : 482913 » down to
 * « Votre », so the field keeps any length and reads the code out of it.
 * When the sixth digit lands the form is sent: nothing is left to tap.
 */
export function OtpCodeInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (code: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const last = useRef(value);

  // After the render that holds the full code, so the form's handler reads it.
  useEffect(() => {
    if (value.length === OTP_LENGTH && last.current !== value) ref.current?.form?.requestSubmit();
    last.current = value;
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      value={value}
      onChange={(e) => onChange(otpEntry(e.target.value))}
      placeholder="••••••"
      aria-label={ariaLabel}
      className="mt-5 w-full rounded-xl border border-mazed-gold/25 bg-mazed-surface-2 px-4 py-3 text-center text-[22px] font-bold tracking-[0.4em] text-mazed-cream placeholder:text-mazed-muted focus:border-mazed-gold focus:outline-none focus:ring-1 focus:ring-mazed-gold/40"
    />
  );
}
