"use client";

import { useSyncExternalStore } from "react";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";

// Cookies have no change event, so there is nothing to subscribe to. The
// snapshot is re-read on every render of the caller — the header re-renders on
// each navigation — and signing in or out ends in a full page load anyway.
const subscribe = () => () => {};
const getSnapshot = () => hasSupabaseSessionCookie();
const getServerSnapshot = () => null;

/**
 * Whether this browser holds a Supabase session cookie — `null` on the server
 * and during hydration, where the static HTML cannot know.
 *
 * For chrome that renders on every page: `false` means a guest, and a guest
 * needs neither the Supabase client nor a request to confirm it.
 */
export function useSessionCookie(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
