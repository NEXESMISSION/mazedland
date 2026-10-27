"use client";

import { useEffect } from "react";

/**
 * No figure on the site is negative — a price, a surface, a floor, a budget, a
 * setting — so a number field never takes a minus sign (or the « e » of an
 * exponent, which lets one in). One listener for every number field, the
 * console's included, rather than a rule repeated in each form; the server
 * refuses a negative value on its own anyway (src/lib/listings/input.ts).
 */
export function NoNegativeNumbers() {
  useEffect(() => {
    const isNumberField = (t: EventTarget | null): t is HTMLInputElement =>
      t instanceof HTMLInputElement && t.type === "number";
    const onKey = (e: KeyboardEvent) => {
      if (isNumberField(e.target) && (e.key === "-" || e.key === "e" || e.key === "E")) e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isNumberField(e.target) && /[-eE]/.test(e.clipboardData?.getData("text") ?? "")) e.preventDefault();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, []);
  return null;
}
