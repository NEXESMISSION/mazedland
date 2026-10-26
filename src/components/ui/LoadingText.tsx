"use client";

import { useTranslations } from "next-intl";

/**
 * "Chargement…" in the page's language, for the screen-reader line of a
 * loading state.
 *
 * A client component on purpose. The `loading.tsx` files and the skeletons
 * they render are server components with no locale param, and next-intl on the
 * server would fall back to reading request headers for the locale — which
 * turns a statically rendered page (home is ISR) dynamic. On the client the
 * text comes from the messages the locale layout already hands down.
 */
export function LoadingText({ className = "sr-only" }: { className?: string }) {
  const t = useTranslations("common");
  return <span className={className}>{t("loading")}</span>;
}
