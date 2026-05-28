"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

/**
 * Sign-out: do BOTH the SDK signOut (clears local auth state) and the
 * server-side endpoint (clears the SSR cookie). Either alone leaves a
 * user "half-signed-out" — the other half re-hydrates the session on
 * the next render.
 *
 * Hard-navigate after the cookie is cleared (mirrors the LoginForm
 * pattern) so the next render attaches the up-to-date cookie state.
 */
export function SignOutButton({ label }: { label: string }) {
  const locale = useLocale();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      // Drop any in-flight KYC draft (storage paths to the previous
      // user's CIN photos) before the cookie clear, so the next sign-in
      // on this browser starts the wizard from scratch.
      try {
        sessionStorage.removeItem("batta_kyc_draft");
      } catch {
        /* sessionStorage unavailable — nothing to clean. */
      }

      const supabase = getBrowserSupabase();
      await Promise.all([
        supabase.auth.signOut(),
        fetch("/api/auth/signout", {
          method: "POST",
          // Force the JSON branch on the route — without this, the route
          // returns a 303 redirect that fetch silently follows.
          headers: { Accept: "application/json" },
        }),
      ]);
      window.location.assign(`/${locale}`);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="batta-btn-ghost-gold tap-target w-full px-5 py-3 text-[13px] disabled:opacity-50"
    >
      <LogOut className="size-4" strokeWidth={2} />
      {pending ? "…" : label}
    </button>
  );
}
