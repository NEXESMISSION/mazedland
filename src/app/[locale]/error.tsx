"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, RotateCcw, Home, WifiOff } from "lucide-react";
import { reportClientError } from "@/components/observability/ClientErrorReporter";

/**
 * Locale-root error boundary. Without this, a render error anywhere
 * inside [locale]/* bubbled to Next's default white screen with no
 * recovery path — the user had to manually edit the URL. This catches
 * any uncaught client error, logs the digest for cross-referencing
 * server logs, and gives the user two clear paths out: retry (which
 * re-renders the segment) or go home.
 *
 * Server-side errors (thrown in server components) also hit this
 * boundary; Next strips the message in prod, so we only ever show
 * the digest (a short opaque id) rather than potentially-sensitive
 * server stack traces.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Plain useParams + raw <a> here on purpose — when this boundary
  // fires, the NextIntlClientProvider context may not be available
  // (we're rendered as a sibling, not a child, of the layout). The
  // i18n Link helper would crash with "no intl context".
  const params = useParams<{ locale?: string }>();
  const locale = typeof params?.locale === "string" ? params.locale : "fr";

  // Tag the boundary cause. A network-flavored failure deserves a
  // friendlier surface (and auto-retry on reconnect) — a real bug in
  // a server / client component still gets the generic "something went
  // wrong" screen because retrying won't help on its own.
  const msg = (error?.message ?? "").toLowerCase();
  const isNetwork =
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed") ||
    msg.includes("connection") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout");

  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // Ship boundary-caught errors to the server sink (these never reach
    // window.onerror). Network blips aren't bugs — skip those to keep the
    // signal clean. Server components' errors are also captured server-side
    // by instrumentation.ts; this covers the client-render path + the digest.
    if (!isNetwork) {
      reportClientError({
        message: error?.message || "Segment render error",
        stack: error?.stack,
        source: error?.digest ? `digest:${error.digest}` : undefined,
        kind: "react-boundary",
      });
    }
  }, [error, isNetwork]);

  // Auto-recover network-flavored failures the moment the browser
  // tells us we're back online. The NetworkStatus banner shows the
  // "Connexion rétablie" confirmation; this boundary silently re-runs
  // its segment so the user lands back where they were.
  useEffect(() => {
    if (!isNetwork) return;
    function onOnline() {
      setRetrying(true);
      // Tiny delay so the user sees the spinner state — and so DNS /
      // routing has a beat to settle before the segment re-fetches.
      setTimeout(() => reset(), 350);
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [isNetwork, reset]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-md flex-col items-center justify-center px-6 text-center">
      <div
        className={`size-14 rounded-full flex items-center justify-center ring-1 ${
          isNetwork
            ? "bg-amber-500/15 ring-amber-500/30 text-amber-300"
            : "bg-red-500/15 ring-red-500/30 text-red-300"
        }`}
      >
        {isNetwork ? (
          <WifiOff className="size-7" strokeWidth={1.8} />
        ) : (
          <AlertTriangle className="size-7" strokeWidth={1.8} />
        )}
      </div>
      <h1 className="mt-5 text-[22px] font-extrabold leading-tight tracking-tight">
        {isNetwork
          ? "Connexion interrompue"
          : "Quelque chose s'est mal passé"}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        {isNetwork
          ? "Votre appareil semble hors ligne. La page se rechargera automatiquement dès que la connexion revient."
          : "Une erreur inattendue a interrompu la page. Vous pouvez réessayer ; si le problème persiste, signalez-le à l'équipe."}
      </p>
      {error?.digest && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
          ref · {error.digest}
        </p>
      )}
      <div className="mt-6 grid w-full grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setRetrying(true);
            reset();
          }}
          disabled={retrying}
          className="tap-target inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-[var(--gold)] text-white text-[13px] font-bold shadow-[var(--shadow-gold)] hover:bg-[var(--gold-bright)] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          <RotateCcw className={`size-4 ${retrying ? "animate-spin" : ""}`} strokeWidth={2.2} />
          {retrying ? "Reconnexion…" : "Réessayer"}
        </button>
        <a
          href={`/${locale}`}
          className="tap-target inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-foreground text-[13px] font-semibold hover:border-[var(--gold-soft)] hover:text-[var(--gold)] transition-colors"
        >
          <Home className="size-4" strokeWidth={2.2} />
          Accueil
        </a>
      </div>
    </div>
  );
}
