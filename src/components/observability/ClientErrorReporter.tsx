"use client";

import { useEffect } from "react";

/**
 * Reports a client-side error to the server sink. Exported so React error
 * boundaries (error.tsx / global-error.tsx) can call it directly too.
 * Fire-and-forget, deduped by caller, never throws.
 */
export function reportClientError(input: {
  message: string;
  stack?: string;
  source?: string;
  kind?: string;
}): void {
  try {
    const payload = JSON.stringify({
      message: input.message,
      stack: input.stack,
      source: input.source,
      kind: input.kind ?? "error",
      url: typeof location !== "undefined" ? location.pathname + location.search : undefined,
    });
    // sendBeacon survives a page unload (e.g. an error during navigation);
    // fall back to fetch keepalive where it's unavailable.
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/observability/client-error", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/observability/client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  } catch {
    /* observability must never break the app */
  }
}

/**
 * Global client crash listener. Catches the errors React error boundaries
 * miss — uncaught exceptions and unhandled promise rejections anywhere on the
 * page — and ships them to the server sink. Dedupes a short burst of the same
 * message so one repeating error can't flood the endpoint. Mounted once,
 * app-wide, from the root layout.
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const seen = new Map<string, number>();
    const shouldSend = (key: string) => {
      const now = Date.now();
      const last = seen.get(key) ?? 0;
      if (now - last < 10_000) return false; // ≤1 of the same error per 10s
      seen.set(key, now);
      return true;
    };

    const onError = (e: ErrorEvent) => {
      const msg = e.message || "Uncaught error";
      if (!shouldSend(msg)) return;
      reportClientError({
        message: msg,
        stack: e.error?.stack,
        source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
        kind: "window.onerror",
      });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg =
        reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
      if (!shouldSend(msg)) return;
      reportClientError({
        message: msg,
        stack: reason instanceof Error ? reason.stack : undefined,
        kind: "unhandledrejection",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
