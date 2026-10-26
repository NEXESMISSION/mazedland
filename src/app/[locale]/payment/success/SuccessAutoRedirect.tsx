"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { routing } from "@/i18n/routing";

/**
 * Hands off to the return URL after a short delay so the user reads
 * "Paiement confirmé" before the page changes. The /payment/success
 * server component renders the human-facing card; this client widget
 * only handles the navigation timing.
 *
 * `to` is a locale-less internal path, like the page's <Link>s take; the
 * full-page navigation adds the current locale itself, so an Arabic buyer
 * lands on the Arabic page instead of on whatever the middleware guesses.
 */
export function SuccessAutoRedirect({
  to,
  delayMs = 1800,
  enabled = true,
}: {
  to: string;
  delayMs?: number;
  enabled?: boolean;
}) {
  const locale = useLocale();
  useEffect(() => {
    if (!enabled) return;
    const prefixed = routing.locales.some((l) => to === `/${l}` || to.startsWith(`/${l}/`));
    const href = prefixed ? to : `/${locale}${to}`;
    const t = setTimeout(() => {
      window.location.href = href;
    }, delayMs);
    return () => clearTimeout(t);
  }, [to, delayMs, enabled, locale]);
  return null;
}
