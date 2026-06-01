"use client";

import { useEffect } from "react";
import { log } from "@/lib/log";

/**
 * Client-side performance probe. Logs a detailed timing breakdown to the
 * BROWSER console (scope `perf`) so we can see what the user actually
 * experiences — server timings only tell half the story.
 *
 * Emits:
 *   - nav:       TTFB / domInteractive / DCL / load / transfer size
 *   - paint:     first-paint + first-contentful-paint
 *   - LCP:       largest-contentful-paint (the "page looks done" moment)
 *   - long-task: any main-thread block ≥50ms (jank source — e.g. heavy
 *                hydration or the skeleton's shimmer animations)
 *   - resources: per-initiator count + transferred KB + slowest request
 *
 * Gated behind NEXT_PUBLIC_PERF_PROBE=1 (or dev) so it never ships noise
 * to production consoles unless explicitly turned on.
 */
export function PerfProbe({ tag = "page" }: { tag?: string }) {
  useEffect(() => {
    const enabled =
      process.env.NEXT_PUBLIC_PERF_PROBE === "1" ||
      process.env.NODE_ENV !== "production";
    if (!enabled) return;

    const perf = log.scope("perf");
    const t0 = performance.now();
    perf.info(`${tag} mounted (client)`, { sinceNavMs: Math.round(t0) });

    // ── Navigation timing ────────────────────────────────────────────
    try {
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      if (nav) {
        perf.info(`${tag} navigation`, {
          ttfbMs: Math.round(nav.responseStart),
          respEndMs: Math.round(nav.responseEnd),
          domInteractiveMs: Math.round(nav.domInteractive),
          dclMs: Math.round(nav.domContentLoadedEventEnd),
          loadMs: Math.round(nav.loadEventEnd || 0),
          type: nav.type,
          transferKB: Math.round((nav.transferSize || 0) / 1024),
        });
      }
    } catch {
      /* navigation timing unsupported */
    }

    // ── Paint timings (FP / FCP) ─────────────────────────────────────
    try {
      for (const p of performance.getEntriesByType("paint")) {
        perf.info(`${tag} ${p.name}`, { ms: Math.round(p.startTime) });
      }
    } catch {
      /* paint timing unsupported */
    }

    // ── Largest Contentful Paint ─────────────────────────────────────
    let lcpObs: PerformanceObserver | null = null;
    try {
      lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) perf.info(`${tag} LCP`, { ms: Math.round(last.startTime) });
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      /* LCP unsupported */
    }

    // ── Long tasks (main-thread blocks ≥50ms) ────────────────────────
    let ltObs: PerformanceObserver | null = null;
    try {
      ltObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration >= 50) {
            perf.warn(`${tag} long-task`, {
              ms: Math.round(e.duration),
              atMs: Math.round(e.startTime),
            });
          }
        }
      });
      ltObs.observe({ type: "longtask", buffered: true });
    } catch {
      /* longtask unsupported (Safari/Firefox) */
    }

    // ── Resource breakdown (after full load) ─────────────────────────
    const summarizeResources = () => {
      try {
        const res = performance.getEntriesByType(
          "resource",
        ) as PerformanceResourceTiming[];
        const byType: Record<string, { n: number; kb: number; maxMs: number }> = {};
        let slowest: { name: string; ms: number } | null = null;
        for (const r of res) {
          const type = r.initiatorType || "other";
          byType[type] ??= { n: 0, kb: 0, maxMs: 0 };
          byType[type].n += 1;
          byType[type].kb += (r.transferSize || 0) / 1024;
          byType[type].maxMs = Math.max(byType[type].maxMs, r.duration);
          if (!slowest || r.duration > slowest.ms) {
            slowest = {
              name: r.name.split("/").pop()?.split("?")[0] || r.name,
              ms: Math.round(r.duration),
            };
          }
        }
        for (const [type, v] of Object.entries(byType)) {
          perf.info(`${tag} resources:${type}`, {
            count: v.n,
            kb: Math.round(v.kb),
            maxMs: Math.round(v.maxMs),
          });
        }
        if (slowest) {
          perf.warn(`${tag} slowest-resource`, slowest);
        }
      } catch {
        /* resource timing unsupported */
      }
    };
    if (document.readyState === "complete") summarizeResources();
    else window.addEventListener("load", summarizeResources, { once: true });

    return () => {
      lcpObs?.disconnect();
      ltObs?.disconnect();
      window.removeEventListener("load", summarizeResources);
    };
  }, [tag]);

  return null;
}
