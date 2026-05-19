"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { log } from "@/lib/log";

/**
 * Mounted once in the root layout. Compact browser console:
 *
 *   12:34:56 cli  boot · /fr · 375×812 · 4g
 *   12:34:56 cli  GET /api/notifications 200 · 40ms
 *   12:34:56 cli  nav /fr/auctions
 *   WARN  12:34:56 cli  GET /api/x 503 · 200ms
 *   ERROR 12:34:56 cli  TypeError: x is not a function
 *
 * One line per event. Boot details collapsed. Fetch logs only the
 * completion (entry was redundant). Set `NEXT_PUBLIC_LOG_LEVEL=debug`
 * to see everything; `info` (prod default) is already quiet enough.
 */
export function ClientLogger() {
  const pathname = usePathname();
  const search = useSearchParams();
  const bootedRef = useRef(false);

  // Boot — single compact line on first paint.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const conn = getConnectionInfo();
    log.scope("cli").info(
      `boot ${pathname}${search?.toString() ? `?${search.toString()}` : ""}`,
      {
        vw: `${window.innerWidth}x${window.innerHeight}`,
        net: conn?.effectiveType ?? navigator.onLine ? "on" : "off",
      },
    );
  }, [pathname, search]);

  // fetch() patch — single completion line per call.
  useEffect(() => {
    const l = log.scope("cli");
    type Patched = Window & { __batta_fetch_patched?: boolean };
    if ((window as Patched).__batta_fetch_patched) return;
    (window as Patched).__batta_fetch_patched = true;

    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const t0 = performance.now();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      // Trim long URLs and strip the origin if it matches the page so
      // logs stay readable.
      let short = url;
      try {
        const u = new URL(url, window.location.origin);
        short = u.origin === window.location.origin ? u.pathname + u.search : url;
      } catch {
        /* not a URL */
      }
      if (short.length > 80) short = short.slice(0, 80) + "…";

      try {
        const res = await original(input, init);
        const ms = Math.round(performance.now() - t0);
        const line = `${method} ${short} ${res.status}`;
        if (res.status >= 500) l.error(line, { ms });
        else if (res.status >= 400) l.warn(line, { ms });
        else l.debug(line, { ms });
        return res;
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        l.error(`${method} ${short} failed`, { ms, err: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    };
  }, []);

  // Global error + rejection handlers.
  useEffect(() => {
    const l = log.scope("cli");
    function onError(ev: ErrorEvent) {
      l.error(`${ev.message}`, {
        at: `${ev.filename}:${ev.lineno}:${ev.colno}`,
      });
    }
    function onRejection(ev: PromiseRejectionEvent) {
      const r = ev.reason;
      if (r instanceof Error) l.error(r.message);
      else l.error("unhandledrejection", { reason: String(r).slice(0, 200) });
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Online/offline only — drop the (very noisy) visibilitychange spam.
  useEffect(() => {
    const l = log.scope("cli");
    function onOnline() { l.info("online"); }
    function onOffline() { l.warn("offline"); }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Route changes — single line per nav (and not on first render, that's boot).
  useEffect(() => {
    if (!bootedRef.current) return;
    log.scope("cli").info(`nav ${pathname}${search?.toString() ? `?${search.toString()}` : ""}`);
  }, [pathname, search]);

  return null;
}

function getConnectionInfo() {
  type Conn = {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  const nav = navigator as Navigator & { connection?: Conn };
  return nav.connection ? { effectiveType: nav.connection.effectiveType } : undefined;
}
