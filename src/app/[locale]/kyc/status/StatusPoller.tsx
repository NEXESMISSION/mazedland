"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Mounted by /kyc/status only while the verdict is `submitted` or
 * `pending`. Periodically refreshes the auth session so an admin
 * approval picks up without forcing the user to sign out/in. Caps
 * itself at 20 minutes so a user who leaves the tab open doesn't
 * keep hitting Supabase forever — they can manually refresh after.
 */
export function StatusPoller() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    const started = Date.now();
    const MAX_MS = 20 * 60 * 1000;

    async function refresh() {
      if (cancelled) return;
      try {
        await supabase.auth.refreshSession();
        // Re-fetch the server component so the status branch re-renders
        // if the profile flipped to verified/rejected.
        router.refresh();
      } catch {
        // ignore — next tick will try again
      }
    }

    const id = setInterval(() => {
      if (Date.now() - started > MAX_MS) {
        clearInterval(id);
        return;
      }
      refresh();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return null;
}
