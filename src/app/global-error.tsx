"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself (above
 * the [locale] error boundary). It must render its own <html>/<body> because
 * it replaces the root layout. Kept dependency-free (no intl, no design
 * tokens guaranteed) so it can't fail to render.
 */
const BLOCK: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.75rem",
  width: "100%",
  maxWidth: 360,
};

const BUTTON: React.CSSProperties = {
  height: 44,
  padding: "0 24px",
  borderRadius: 999,
  border: "none",
  background: "#18181b",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};

/**
 * Why the layout failed, as far as the browser can tell.
 *
 * - "stale": a piece of the page's code could not be fetched. The header's
 *   notification bell and the popups load on their own after the page, so a
 *   tab opened before a deploy (or on a dev server that has since stopped)
 *   fails here, in the layout, and lands on this screen instead of the
 *   locale's. A reload fetches the current code.
 * - "offline": the network went away.
 * - "bug": anything else.
 */
function causeOf(error: Error | undefined): "stale" | "offline" | "bug" {
  const msg = (error?.message ?? "").toLowerCase();
  if (
    error?.name === "ChunkLoadError" ||
    /loading (css )?chunk|failed to load chunk|dynamically imported module|importing a module script failed/.test(msg)
  ) {
    return "stale";
  }
  if (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /failed to fetch|networkerror|load failed|network request failed/.test(msg)
  ) {
    return "offline";
  }
  return "bug";
}

const RELOADED_AT = "mazed:global-error-reload";

const TEXT = {
  stale: {
    fr: ["La page se met à jour", "Une nouvelle version du site est en ligne. La page se recharge…"],
    ar: ["الصفحة تتحدّث", "فما نسخة جديدة من الموقع. الصفحة تتعاود تتحلّ…"],
  },
  offline: {
    fr: ["Connexion perdue", "Vérifiez votre connexion : la page se recharge dès qu'elle revient."],
    ar: ["الكونكسيون طاحت", "ثبّت في الكونكسيون متاعك: الصفحة تتعاود تتحلّ أوّل ما ترجع."],
  },
  bug: {
    fr: [
      "Une erreur est survenue",
      "L'application a rencontré un problème inattendu. Réessayez ; si cela persiste, signalez-le à l'équipe.",
    ],
    ar: ["صار مشكل", "تعرّض التطبيق لمشكلة غير متوقّعة. أعد المحاولة؛ وإذا استمرّت المشكلة، أبلغ الفريق بها."],
  },
} as const;

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const cause = causeOf(error);

  useEffect(() => {
    console.error("[boundary] global error", {
      message: error?.message,
      digest: error?.digest,
      cause,
    });
    // Ship to the observability sink so a ROOT-layout crash lands in the same
    // server-side stream + /admin/activity as every other error — not just the
    // user's browser console (where no operator ever sees it). Best-effort +
    // keepalive so the beacon survives the boundary re-render; never throws.
    // A lost connection is not a bug, and the beacon could not leave anyway.
    if (cause !== "offline") {
      try {
        fetch("/api/observability/client-error", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "global_error",
            message: `${cause === "stale" ? "[stale] " : ""}${error?.message ?? "(no message)"}`,
            stack: error?.stack,
            url: typeof window !== "undefined" ? window.location.href : undefined,
            source: error?.digest ? `digest:${error.digest}` : undefined,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* observability must never break the last-resort boundary */
      }
    }

    // Stale code: one automatic reload, then never again for half a minute,
    // so a page that keeps failing shows this screen instead of looping.
    if (cause === "stale") {
      try {
        const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(RELOADED_AT, String(Date.now()));
          window.location.reload();
        }
      } catch {
        /* storage blocked: the button still reloads */
      }
    }
    // Offline: reload the moment the connection comes back.
    if (cause === "offline") {
      const onOnline = () => window.location.reload();
      window.addEventListener("online", onOnline);
      return () => window.removeEventListener("online", onOnline);
    }
  }, [error, cause]);

  // A full reload, not reset(): what failed is the layout, and re-rendering it
  // with the same missing piece fails the same way.
  const retry = () => window.location.reload();
  const [frTitle, frBody] = TEXT[cause].fr;
  const [arTitle, arBody] = TEXT[cause].ar;

  return (
    // No intl provider up here and no way to know the reader's language (the
    // [locale] layout is what failed), so — like the root not-found page — it
    // says it in French and in Arabic, each block with its own retry button.
    <html lang="fr" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#ffffff",
          color: "#18181b",
        }}
      >
        <section style={BLOCK}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{frTitle}</h1>
          <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 360, margin: 0 }}>{frBody}</p>
          <button type="button" onClick={retry} style={BUTTON}>
            Réessayer
          </button>
        </section>

        <section
          lang="ar"
          dir="rtl"
          style={{ ...BLOCK, borderTop: "1px solid #e4e4e7", paddingTop: "1.5rem", marginTop: "0.5rem" }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{arTitle}</h2>
          <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 360, margin: 0 }}>{arBody}</p>
          <button type="button" onClick={retry} style={BUTTON}>
            عاود جرّب
          </button>
        </section>

        {/* What failed, in one line, so a screenshot of this page says where
            to look. A server error's message is already replaced by Next in
            production; a browser one names the missing piece. */}
        {(error?.digest || error?.message) && (
          <p
            dir="ltr"
            style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace", margin: 0, maxWidth: 420, overflowWrap: "anywhere" }}
          >
            {error?.digest ? `ref · ${error.digest}` : ""}
            {error?.digest && error?.message ? " · " : ""}
            {error?.message ? error.message.slice(0, 160) : ""}
          </p>
        )}
      </body>
    </html>
  );
}
