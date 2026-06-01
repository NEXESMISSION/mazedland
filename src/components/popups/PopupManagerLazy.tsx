"use client";

import dynamic from "next/dynamic";

/**
 * Client wrapper that lazy-loads PopupManager with ssr:false. PopupManager
 * fetches /api/popups/match on mount and renders nothing until a popup
 * matches, so it has zero first-paint value — deferring it keeps its JS +
 * that network call off the critical path on every page. The layout is a
 * Server Component (can't use ssr:false directly), hence this wrapper.
 */
const PopupManager = dynamic(
  () => import("./PopupManager").then((m) => m.PopupManager),
  { ssr: false },
);

export function PopupManagerLazy() {
  return <PopupManager />;
}
