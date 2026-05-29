"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

interface Props {
  /** Prefix used by the rendering server page when stamping row ids.
   *  Mounted page renders e.g. `id="pay-<row_id>"`; this component looks
   *  up `pay-<focus>` so the same prefix has to be passed in both places. */
  idPrefix: string;
}

/**
 * On mount, reads `?focus=<id>` from the URL and rings the matching row.
 *
 * Notification list pages (account/payments, account/activity,
 * account/inspections) use this to scroll-to + flash the specific row a
 * notification refers to. The lookup is `document.getElementById(prefix +
 * focus)`, so the rendering page must stamp `id={prefix + row.id}` on its
 * row containers.
 *
 * Ringing is a one-shot CSS animation; we never hold the ring after the
 * animation finishes so re-clicking the same notification can re-trigger
 * it. The component renders nothing and does not interfere with SSR.
 */
export function FocusRowHighlight({ idPrefix }: Props) {
  const search = useSearchParams();
  const focus = search.get("focus");

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`${idPrefix}${focus}`);
    if (!el) return;
    // Wait a tick so the layout settles (some lists virtualize / lazy-mount).
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("batta-focus-ring");
      window.setTimeout(() => el.classList.remove("batta-focus-ring"), 2400);
    }, 60);
    return () => window.clearTimeout(t);
  }, [focus, idPrefix]);

  return null;
}
