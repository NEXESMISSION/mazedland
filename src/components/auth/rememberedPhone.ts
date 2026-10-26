"use client";

import { useSyncExternalStore } from "react";

/**
 * The number typed on the login form, for the forms one goes to from there:
 * « Mot de passe oublié ? » and « Créer un compte » open with it filled in
 * instead of asking for it again. It lives in this tab's sessionStorage —
 * gone when the tab closes — and nowhere else (never in a URL). Storage can
 * be refused (private mode): then nothing is remembered and nothing breaks.
 */
const KEY = "mazed:auth-phone";

export function rememberPhone(dialCode: string, number: string): void {
  try {
    if (number) sessionStorage.setItem(KEY, `${dialCode} ${number}`);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: the next form asks for the number, as before.
  }
}

/** Signed in, or the password changed: the number has done its job. */
export function forgetPhone(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

/**
 * The remembered number, or null — null on the server and during hydration
 * too, so the field fills in right after, with no mismatch. The forms use it
 * as the starting value until the person types.
 */
export function useRememberedPhone(): { dialCode: string; number: string } | null {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const [dialCode, number] = (raw ?? "").split(" ");
  return /^\+\d{1,4}$/.test(dialCode ?? "") && /^\d{4,15}$/.test(number ?? "") ? { dialCode, number } : null;
}
