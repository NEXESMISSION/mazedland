"use client";

import { useSyncExternalStore } from "react";
import { useSetting } from "@/components/settings/SettingsProvider";

/**
 * The annonces picked for comparison, kept in this browser only (a visitor
 * compares without an account). Every toggle and bar reads the same list and
 * hears every change, in this tab and in the others. It holds `compare_max`
 * at most; a list kept from when the console allowed more shows its first ones.
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
    ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : EMPTY;
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
  const max = useSetting("compare_max");
  const stored = useSyncExternalStore(subscribe, read, () => EMPTY);
  const ids = stored.length > max ? stored.slice(0, max) : stored;
  const current = () => read().slice(0, max);
  return {
    ids,
    max,
    has: (id: string) => ids.includes(id),
    full: ids.length >= max,
    /** Adds or removes; false when the list is full and nothing was added. */
    toggle(id: string): boolean {
      const now = current();
      if (now.includes(id)) {
        write(now.filter((x) => x !== id));
        return true;
      }
      if (now.length >= max) return false;
      write([...now, id]);
      return true;
    },
    remove: (id: string) => write(current().filter((x) => x !== id)),
    clear: () => write([]),
  };
}
