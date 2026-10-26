"use client";

import { useSyncExternalStore } from "react";
import { COMPARE_MAX } from "@/lib/compare";

/**
 * The annonces picked for comparison, kept in this browser only (a visitor
 * compares without an account). Every toggle and bar reads the same list and
 * hears every change, in this tab and in the others.
 */
const KEY = "mazed:compare";
const EVENT = "mazed:compare";
const EMPTY: string[] = [];
let cache: { raw: string | null; ids: string[] } = { raw: null, ids: EMPTY };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.ids;
  let ids: string[] = EMPTY;
  try {
    const parsed = JSON.parse(raw ?? "[]");
    ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX) : EMPTY;
  } catch {
    ids = EMPTY;
  }
  cache = { raw, ids };
  return ids;
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked: the list lives for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCompare() {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    ids,
    has: (id: string) => ids.includes(id),
    full: ids.length >= COMPARE_MAX,
    /** Adds or removes; false when the list is full and nothing was added. */
    toggle(id: string): boolean {
      const now = read();
      if (now.includes(id)) {
        write(now.filter((x) => x !== id));
        return true;
      }
      if (now.length >= COMPARE_MAX) return false;
      write([...now, id]);
      return true;
    },
    remove: (id: string) => write(read().filter((x) => x !== id)),
    clear: () => write([]),
  };
}
