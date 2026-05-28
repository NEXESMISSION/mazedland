"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff, Wifi } from "lucide-react";

type Phase = "online" | "offline" | "reconnected";

/**
 * Top-of-viewport network status strip. Listens to the browser's
 * native `online` / `offline` events (zero polling — they're emitted
 * when the OS / browser flips connectivity state) so we don't burn
 * any usage tracking it.
 *
 * Offline: red strip pinned to the top, message + "Reconnexion…" hint.
 * Back online: green confirmation for ~2 s, then disappears. We also
 * call `router.refresh()` on reconnect so any server-rendered surface
 * (auction prices, KYC status, etc.) re-fetches with the new session.
 *
 * No polling, no fetch, no realtime — the browser tells us. Cheap.
 */
export function NetworkStatus() {
  const router = useRouter();
  // `online` is the default — only show the strip when we transition
  // away from it. SSR has no `navigator`, so we start optimistic.
  const [phase, setPhase] = useState<Phase>("online");
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    // Sync with the actual browser state on mount in case we missed
    // an event between SSR and hydration.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setPhase("offline");
      wasOfflineRef.current = true;
    }

    function onOffline() {
      wasOfflineRef.current = true;
      setPhase("offline");
    }
    function onOnline() {
      // Only celebrate if we actually went down — onOnline can fire on
      // network-config changes (VPN flips, captive-portal sign-in) even
      // when we never showed an offline UI.
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        setPhase("reconnected");
        // Pull the latest server data — the user might have missed an
        // auction extension, a KYC verdict, or a notification.
        router.refresh();
      } else {
        setPhase("online");
      }
    }

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [router]);

  // Auto-hide the "back online" confirmation.
  useEffect(() => {
    if (phase !== "reconnected") return;
    const id = setTimeout(() => setPhase("online"), 2000);
    return () => clearTimeout(id);
  }, [phase]);

  if (phase === "online") return null;

  const isOffline = phase === "offline";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 px-4 py-2 text-[12px] font-bold text-white shadow-lg transition-colors ${
        isOffline ? "bg-red-600" : "bg-green-600"
      }`}
    >
      {isOffline ? (
        <>
          <WifiOff className="size-4 shrink-0" strokeWidth={2.4} />
          <span>Hors ligne — reconnexion automatique…</span>
        </>
      ) : (
        <>
          <Wifi className="size-4 shrink-0" strokeWidth={2.4} />
          <span>Connexion rétablie</span>
        </>
      )}
    </div>
  );
}
