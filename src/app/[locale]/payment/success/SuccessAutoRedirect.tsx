"use client";

import { useEffect } from "react";

/**
 * Hands off to the return URL after a short delay so the user reads
 * "Paiement confirmé" before the page changes. The /payment/success
 * server component renders the human-facing card; this client widget
 * only handles the navigation timing.
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
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      window.location.href = to;
    }, delayMs);
    return () => clearTimeout(t);
  }, [to, delayMs, enabled]);
  return null;
}
