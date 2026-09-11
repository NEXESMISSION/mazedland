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
      // A full reload, not a router push: the next render must be produced
      // with the cleared cookie, and client stores still hold the old user.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload after the auth cookie changes
      window.location.assign(`/${locale}`);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="mazed-btn-ghost-gold tap-target w-full px-5 py-3 text-[13px] disabled:opacity-50"
    >
      <LogOut className="size-4" strokeWidth={2} />
      {pending ? "…" : label}
    </button>
  );
}
