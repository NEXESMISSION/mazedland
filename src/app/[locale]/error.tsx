"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

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

  useEffect(() => {
    // Best-effort visibility for whoever is watching the console —
    // in prod this is the only signal we get unless Sentry is wired.
    // eslint-disable-next-line no-console
    console.error("[boundary] segment error", {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack?.split("\n").slice(0, 4),
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="size-14 rounded-full bg-red-500/15 ring-1 ring-red-500/30 text-red-300 flex items-center justify-center">
        <AlertTriangle className="size-7" strokeWidth={1.8} />
      </div>
      <h1 className="mt-5 text-[22px] font-extrabold leading-tight tracking-tight">
        Quelque chose s&apos;est mal passé
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        Une erreur inattendue a interrompu la page. Vous pouvez réessayer ;
        si le problème persiste, signalez-le à l&apos;équipe.
      </p>
      {error?.digest && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">
          ref · {error.digest}
        </p>
      )}
      <div className="mt-6 grid w-full grid-cols-2 gap-2">
        <button
          type="button"
          onClick={reset}
          className="tap-target inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-[var(--gold)] text-white text-[13px] font-bold shadow-[var(--shadow-gold)] hover:bg-[var(--gold-bright)] active:scale-[0.98] transition-all"
        >
          <RotateCcw className="size-4" strokeWidth={2.2} />
          Réessayer
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
